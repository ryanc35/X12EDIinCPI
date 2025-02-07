sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter", 
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, BusyIndicator, Filter, FilterOperator, MessageBox, MessageToast) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.MapList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                oDataModel.setDeferredGroups(["changes", "deferred"]);

                //Read maps during initialization and set default direction
                const pMetadataLoaded = oDataModel.metadataLoaded(),
                    pControlLoaded = this._controlModel.dataLoaded();
                Promise.all([
                    pMetadataLoaded,
                    pControlLoaded
                ]).then((oPromise) => {
                    this._controlModel.setProperty("/maps/direction", "inbound");
                    this._maps = this._controlModel.getProperty("/maps");
                    this._readMaps();
                });

                // Instantiate dialog object for possible alternative partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.MapDialog",
                    type: "XML"
                });

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("self");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Add map
            onAdd: function() {
                // Initialize entry and generate list of available types
                const newEntry = JSON.parse(JSON.stringify(this._controlModel.getProperty("/maps/entryCopy")));
                this._controlModel.setProperty("/maps/entry", newEntry);
                this._generateAvailableTypes();

                // Set mode and call dialog
                this._controlModel.setProperty("/maps/mode", "create");
                this._openDialog();
            },

            // Close dialog
            onCancel: function() {
                this._resetUploadValues();
                this._closeDialog();
            },

            // Delete map
            onDelete: function(oEvent) {
                // Get identifying context for removal
                const oContext = oEvent.getSource().getObjectBinding("control").getContext(),
                    sPath = oContext.getPath(),
                    pid = this._controlModel.getProperty("/self/pid"),
                    id = this._controlModel.getProperty(sPath).id,
                    item = this._getListItem(this._maps.direction, id),
                    inbound = this._controlModel.getProperty("/maps/inbound").map((n) => n),
                    outbound = this._controlModel.getProperty("/maps/outbound").map((n) => n);
                
                // Always delete map and then determine the rest and provide filtered list
                // for update to UI upon success
                var list = [],
                    deletions = [],
                    updateInfo = {};
                deletions.push(id);
                updateInfo = this._determineExtraDeletions(deletions, inbound, outbound, item);
                deletions = updateInfo.deletions;
                list = updateInfo.list;
                
                // Confirm deletion first
                const oDataModel = this._getModel();
                MessageBox.warning(this._i18nBundle.getText("sureQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if(sAction !== MessageBox.Action.CANCEL) {
                            // Continue deleting record(s)
                            BusyIndicator.show(0);
                            for(const deletion of deletions) {
                                const key = "/BinaryParameters(Pid='" + pid + 
                                            "',Id='" + deletion + "')";
                                oDataModel.remove(key, {
                                    groupId: "deferred",
                                    refreshAfterChange: false
                                });
                            }

                            // Submit changes
                            this._submit().then((oData, oResponse) => {
                                this._controlModel.setProperty("/maps/" + this._maps.direction, list);
                                BusyIndicator.hide();
                            }).catch((oError) => {
                                BusyIndicator.hide();
                                MessageToast.show(this._i18nBundle.getText("mapDeletionFailed"))
                            });
                        }
                    }.bind(this)
                });
            },

            // Populate JSON model context
            onPatternMatched: function(oEvent) {
                this._maps = this._controlModel.getProperty("/maps");
            },

            // Save map
            onSave: function() {
                // Ignore request if any input field is in value state error
                // or a payload was not supplied in create mode
                if(this._hasErrorStates()) {
                    return;
                }

                // Generate Ids to determine if it should require create or update
                const oDataModel = this._getModel(),
                    pid = this._controlModel.getProperty("/self/pid"),
                    x12Type = "ASC-X12_" + this._maps.entry.x12Type + 
                                    "_" + this._maps.entry.x12Version;
                this._controlModel.setProperty("/maps/entry/conversion/name", x12Type);
                if(this._maps.direction === "inbound") {
                    this._controlModel.setProperty("/maps/entry/preProcessing/name", x12Type + "_preproc");
                    this._controlModel.setProperty("/maps/entry/mapping/name", x12Type + "_to_" + this._maps.entry.target);
                    this._controlModel.setProperty("/maps/entry/postProcessing/name", this._maps.entry.target + "_postproc");
                } else {
                    this._controlModel.setProperty("/maps/entry/preProcessing/name", this._maps.entry.source + "_preproc");
                    this._controlModel.setProperty("/maps/entry/mapping/name", this._maps.entry.source + "_to_" + x12Type);
                    this._controlModel.setProperty("/maps/entry/postProcessing/name", x12Type + "_postproc");
                }

                // Process each object and determine update mode
                for(const object of this._maps.objects) {
                    const oObject = this._maps.entry[object],
                        key = "/BinaryParameters(Pid='" + pid + "',Id='" + oObject.name + "')";
                    
                    // Don't submit updates for empty strings
                    if(oObject.value) {
                        if(oDataModel.getObject(key)) {
                            oDataModel.update(key, {
                                ContentType: oObject.type,
                                Value: oObject.value
                            },{
                                groupId: "deferred",
                                merge: false,
                                refreshAfterChange: false
                            })
                        } else {
                            oDataModel.create("/BinaryParameters", {
                                Pid: pid,
                                Id: oObject.name,
                                ContentType: oObject.type,
                                Value: oObject.value
                            },{
                                groupId: "deferred",
                                refreshAfterChange: false
                            })
                        }
                    }
                }

                // Submit batch if pending changes exist
                if(oDataModel.hasPendingChanges(true)) {
                    this._submit().then((oData, oResponse) => {
                        // Check if map was created - if so, populate JSON model for UI display
                        for(const response of oData.__batchResponses[0].__changeResponses) {
                            if(response.statusCode === "201" && response.data.Id.includes("_to")) {
                                const direction = this._maps.direction,
                                    list = this._controlModel.getProperty("/maps/" + direction).map((n) => n),
                                    item = this._getListItem(direction, response.data.Id);
                                list.push(item);
                                this._controlModel.setProperty("/maps/" + direction, list);
                            }
                        }

                        // Reset uploader controls and close dialog
                        this._resetUploadValues();
                        this._closeDialog();
                    }).catch((oError) => {
                        // Reset uploader controls, close dialog and display error
                        this._resetUploadValues();
                        this._closeDialog();
                        MessageToast.show(this._i18nBundle.getText("mapUpdateFailed"));
                    });
                }
            },

            // Item selection - get key for navigation to detail display
            onSelect: function(oEvent) {
                // Get map key information for data retrieval
                const oItem  =  oEvent.getParameter("listItem"),
                    sPath = oItem.getBindingContext("control").getPath(),
                    id = this._controlModel.getProperty(sPath).id,
                    item = this._getListItem(this._maps.direction, id),
                    entry = JSON.parse(JSON.stringify(this._controlModel.getProperty("/maps/entryCopy"))),
                    isAdmin = this.getOwnerComponent().getModel("control").getProperty("/isAdmin");

                if(!isAdmin) {
                    oItem.getParent().removeSelections(true);
                    return;
                }

                // pre-populate dialog based off map and direction context
                entry.x12Type = item.x12Type;
                entry.x12Version = item.x12Version;
                if(this._maps.direction === "inbound") {
                    entry.target = item.idoc;
                } else {
                    entry.source = item.idoc;
                }
                this._controlModel.setProperty("/maps/entry", entry);
                this._controlModel.setProperty("/maps/mode", "change");

                // open dialog for changes
                oItem.getParent().removeSelections(true);
                this._openDialog();
            },

            // X12 type selection is changed
            onSelectType: function(oEvent) {
                const key = oEvent.getParameter("selectedItem").getKey();
                this._getAvailableVersions(key);
            },

            // Set direction based on tab choice
            onSwitch: function(oEvent) {
                this._controlModel.setProperty("/maps/direction", oEvent.getParameter("selectedKey"));
            },

            // Process file upload
            onUpload: function(oEvent) {
                // Get file and message key information
                const file = oEvent.getParameter("files")[0],
                    parameters = oEvent.getSource().getParameters(),
                    target = parameters[0].getName() === "target" ? parameters[0].getValue() : undefined,
                    oReader = new FileReader();

                // Register onload function
                oReader.onload = function(file) {
                    // Populate base64 content into JSON model
                    const value = this._toBase64(file.currentTarget.result);
                    this._controlModel.setProperty(target, value);
                }.bind(this)

                // Read file
                oReader.readAsText(file);
            },

            // Trigger enter for validation to ensue
            triggerEnterKey: function(oEvent) {
                oEvent.getSource().onsapenter(oEvent);
            },

            // Close map dialog
            _closeDialog: function() {
                this._oDialog.close();
            },

            // Determine any extra deletions
            _determineExtraDeletions: function(deletions, inbound, outbound, item) {
                // Get current direction for list parsing
                const direction = this._maps.direction,
                    typeKey = "ASC-X12_" + item.x12Type + "_" + item.x12Version;
                var list;

                // Delete id of item and then check remaining maps for 
                // existing object depdencies
                if(direction === "inbound") {
                    const index = inbound.map((n) => n.id).indexOf(item.id);
                    delete inbound[index];
                    list = inbound = inbound.filter((n) => true);

                    // pre-processing can always be deleted
                    // but post processsing must be checked for other versions
                    const preProcessingKey = typeKey + "_preproc",
                        postProcessingKey = item.idoc + "_postproc";
                    deletions.push(preProcessingKey);
                    if(!inbound.find((n) => n.idoc === item.idoc)) {
                        deletions.push(postProcessingKey);
                    }
                } else {
                    const index = outbound.map((n) => n.id).indexOf(item.id);
                    delete outbound[index];
                    list = outbound = outbound.filter((n) => true);

                    // post-processing can always be deleted
                    // but pre processsing must be checked for other versions
                    const preProcessingKey = item.idoc + "_preproc",
                        postProcessingKey = typeKey + "_postproc";
                    deletions.push(postProcessingKey);
                    if(!outbound.find((n) => n.idoc === item.idoc)) {
                        deletions.push(preProcessingKey);
                    }
                }

                // Check X12 conversion and ensure it does not exist in any
                // remaining maps
                if(!inbound.find((n) => n.message === typeKey) && 
                    !outbound.find((n) => n.message === typeKey)) {
                    deletions.push(typeKey);
                }

                return {
                    list: list,
                    deletions: deletions
                };
            },

            // Get list of available X12 types for map upload
            _generateAvailableTypes: function() {
                const messages = this._controlModel.getProperty("/x12/types").map((n) => n),
                    direction = this._maps.direction,
                    pid = this._controlModel.getProperty("/self/pid"),
                    oDataModel = this._getModel(),
                    available = [];

                // Check if message object exists
                for(const message of messages) {
                    if(message.type !== "997"){
                        const key = "/BinaryParameters(Pid='" + pid + "',Id='" + 
                                                        message.type + "')",
                            oMessage = oDataModel.getObject(key);
                        if(oMessage) {
                            const JSONObject = JSON.parse(window.atob(oMessage.Value));
                            if(direction === "inbound" && JSONObject.Inbound){
                                available.push({
                                    type: message.type,
                                    target: JSONObject.Inbound.Target
                                });
                            } else if (direction === "outbound" && JSONObject.Outbound) {
                                available.push({
                                    type: message.type
                                });
                            }
                        }
                    }
                }

                // Get available versions for first time display
                if(available) {
                    // Populate select list
                    this._controlModel.setProperty("/maps/availableTypes", available);
                    this._getAvailableVersions(available[0].type);
                    this._controlModel.setProperty("/maps/entry/x12Type", available[0].type);
                }
            },

            // Get available versions
            _getAvailableVersions: function(type) {
                const versions = this._controlModel.getProperty("/x12/versions").map((n) => n),
                    available = this._controlModel.getProperty("/maps/availableTypes"),
                    maps = this._maps.direction === "inbound" ? this._maps.inbound : this._maps.outbound,
                    defaultVersion = this._controlModel.getProperty("/defaultVersion");
                    var defaultIndex = versions.map((n) => n.version).indexOf(defaultVersion);

                // Iterate maps of type to remove versions and get remaining list
                for(const map of maps) {
                    if(map.x12Type === type) {
                        const index = versions.map((n) => n.version).indexOf(map.x12Version);
                        if(index > -1) {
                            const length = versions.length;
                            delete versions[index];
                            defaultIndex = index < defaultIndex ? defaultIndex-- : 
                                        length === defaultIndex ? defaultIndex-- : defaultIndex;
                        }
                    }
                }

                // Remove empties and populate JSON model
                const availableVersions = versions.filter((n) => true);
                this._controlModel.setProperty("/maps/entry/x12Version", availableVersions[defaultIndex].version);
                this._controlModel.setProperty("/maps/availableVersions", availableVersions);
                if(this._maps.direction === "inbound") {
                    const selectedType = available.find((n) => n.type === type);
                    this._controlModel.setProperty("/maps/entry/target", selectedType.target);
                }
            },

            // Return formatted list item for display in UI
            _getListItem: function(direction, id) {
                // Parsing configuration and parameters
                const config = {
                    "inbound": [
                        0,
                        1
                    ],
                    "outbound": [
                        1,
                        0
                    ]
                },
                    parts = id.split("_to_"),
                    x12Parts = parts[config[direction][0]].replaceAll("ASC-X12_", "").split("_");

                // Generate return item
                return {
                    id: id,
                    message: parts[config[direction][0]],
                    idoc: parts[config[direction][1]],
                    x12Type: x12Parts[0],
                    x12Version: x12Parts[1]
                };
            },

            // Get model for view
            _getModel: function() {
                return this.getOwnerComponent().getModel("messages");
            },

            // Check for error states on input fields
            _hasErrorStates: function() {
                if(this._maps.mode === "create") {
                    // Validate input fields
                    for(const input of this._maps.inputs) {
                        const oField = this._oView.byId(input);
                        if(oField.getValueState() === "Error") {
                            return true;
                        }
                    }
                    // Validate all four file streams exist
                    if(!this._maps.entry.conversion.value ||
                        !this._maps.entry.mapping.value ||
                        !this._maps.entry.preProcessing.value ||
                        !this._maps.entry.postProcessing.value) {
                        return true;
                    }
                } else {
                    // Validate at least one stream exists for
                    // update mode
                    if(!this._maps.entry.conversion.value &&
                        !this._maps.entry.mapping.value &&
                        !this._maps.entry.preProcessing.value &&
                        !this._maps.entry.postProcessing.value) {
                        return true;
                    }
                }

                return false;
            },

            // Open dialog for map maintenance
            _openDialog: function() {
                // Display dialog
                this._pDialog.then(function(oDialog) {
                    this._oDialog = oDialog;
                    this._oDialog.open();
                }.bind(this));
            },

            // Read map data
            _readMaps: function() {
                // Create message model and get list of maps
                const oDataModel = this._getModel();
                oDataModel.read("/BinaryParameters", {
                    filters: [new Filter({
                        path: "Pid",
                        operator: FilterOperator.EQ,
                        value1: "'" + this._controlModel.getProperty("/self/pid") + "'"
                    }), new Filter({
                        path: "ContentType",
                        operator: FilterOperator.NE,
                        value1: "json"
                    })],
                    urlParameters: {
                        "$select": "Pid,Id"
                    },
                    success: (oData, oResponse) => {
                        // Parse map information
                        const inbound = [],
                            outbound = [];

                        for(const data of oData.results) {
                            if(data.Id.includes("_to_")) {
                                const parts = data.Id.split("_to_"),
                                    direction = parts[0].startsWith("ASC-X12_") ? "inbound" : "outbound",
                                    item = this._getListItem(direction, data.Id);

                                if(direction === "inbound") {
                                    inbound.push(item);
                                } else {
                                    outbound.push(item);
                                }
                            }
                        }

                        // Store into JSON model for display
                        this._controlModel.setProperty("/maps/inbound", inbound);
                        this._controlModel.setProperty("/maps/outbound", outbound);
                    }
                })
            },

            // Reset values of file uploader controls
            _resetUploadValues: function() {
                const uploaders = this._controlModel.getProperty("/maps/resetValues");
                for(const uploader of uploaders) {
                    const oUploader = this._oView.byId(uploader);
                    oUploader.setValue("");
                }
            },

            // Submit changes
            _submit: function() {
                return new Promise((resolve, reject) => {
                    this._getModel().submitChanges({
                        groupId: "deferred",
                        success: function(oData, oResponse) {
                            resolve(oData, oResponse);
                        },
                        error: function(oError) {
                            reject(oError);
                        }
                    });
                });
            },

            // To base64
            _toBase64: function(string) {
                // Execute conversion to handle UTF-8
                return btoa(encodeURIComponent(string).replace(/%([0-9A-F]{2})/g,
                    function toSolidBytes(match, p1) {
                        return String.fromCharCode('0x' + p1);
                }));
            }
        });
    });