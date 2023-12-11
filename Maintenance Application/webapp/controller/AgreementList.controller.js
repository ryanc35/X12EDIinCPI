sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter", 
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, Filter, FilterOperator, MessageBox, MessageToast) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.AgreementList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                oDataModel.setDeferredGroups(["changes", "deferred"]);

                // Instantiate dialog object for possible alternative partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.AgreementDialog",
                    type: "XML"
                });

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("partner");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Open add dialog
            onAdd: function() {
                // Generate list of available agreements for chosen direction
                const direction = this._controlModel.getProperty("/partners/agreements/direction"),
                    available = this._controlModel.getProperty("/partners/agreements/available"),
                    newEntry = JSON.parse(JSON.stringify(
                                            this._controlModel.getProperty("/partners/agreements/newEntryCopy")));

                if(direction === "inbound") {
                    newEntry.message = available.inbound[0].message;
                } else {
                    newEntry.message = available.outbound[0].message;
                    newEntry.canChangeArchive = newEntry.archiveMessage = 
                        this._getArchiveActive(this._getX12Parts(newEntry.message).x12Type);
                }
                this._controlModel.setProperty("/partners/agreements/newEntry", newEntry);

                // Open agreement creation dialog
                this._openDialog();
            },

            // Add agreement to new configuration list
            onAddAgreement: function() {
                // Retrieve context information
                const key = this._oView.byId("agreementTabs").getSelectedKey(),
                    configuration = this._controlModel.getProperty("/partners/agreements/newConfiguration"),
                    entry = this._controlModel.getProperty("/partners/agreements/newEntry");

                // Adjust model
                var message = this._getX12Parts(entry.message);
                if(key === "inbound") {
                    message.doExtendedPreProcessing = entry.doExtendedPreProcessing;
                    configuration.inbound.push(message);
                } else {
                    message.doExtendedPostProcessing = entry.doExtendedPostProcessing;
                    message.acknowledgementRequired = entry.acknowledgementRequired;
                    message.archiveMessage = entry.archiveMessage;
                    message.canChangeArchive = this._getArchiveActive(message.x12Type);
                    configuration.outbound.push(message);
                }

                // Push changes to control model and re-determine if there are any availble
                this._controlModel.setProperty("/partners/agreements/newConfiguration", configuration);
                this._controlModel.setProperty("/partners/agreements/hasChanges", true);
                this._populateAvailableAgreements();
                this._closeDialog();
            },

            // Record change for tracking purposes since no OData model is bound to agreements
            onChange: function() {
                this._controlModel.setProperty("/partners/agreements/hasChanges", true);
            },

            // Revert to copy of original configuration (if applicable) and toggle mode
            onCancel: function() {
                if(this._agreements.hasChanges) {
                    const original = JSON.parse(JSON.stringify(this._agreements.originalConfiguration));
                    this._controlModel.setProperty("/partners/agreements/newConfiguration", original);
                    this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                    this._resetDeletions();
                    this._populateAvailableAgreements();
                }
                // Always revert to display mode on cancel
                this._controlModel.setProperty("/partners/agreements/mode", "display");
            },

            // Cancel agreement addition
            onCloseDialog: function() {
                this._closeDialog();
            },

            // Remove agreement from model
            onDelete: function(oEvent) {
                // Get identifying context for removal
                const sPath = oEvent.getSource().getObjectBinding("control")
                                    .getContext().getPath(),
                    index = sPath.match(/[^\/]+$/)[0],
                    path = sPath.match(/.*(?=\/.*$)/)[0];

                // Confirm deletion first 
                MessageBox.warning(this._i18nBundle.getText("sureQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.CANCEL) {
                            // Get parameter for processing
                            const agreementList = this._controlModel.getProperty(path),
                                direction = this._controlModel.getProperty("/partners/agreements/direction"),
                                pid = this._controlModel.getProperty("/partners/pid"),
                                deletions = this._controlModel.getProperty("/partners/agreements/extraDeletions"),
                                message = agreementList[index].message,
                                id = direction === "inbound" ? "ext_" + message + "_preproc" :
                                                                "ext_" + message + "_postproc",
                                key = "/BinaryParameters(Pid='" + pid + "',Id='" + id + "')",
                                oObject = this._getModel().getObject(key);

                            // Record deletion in array model and possible extra deletions
                            // for extended maps
                            delete agreementList[index];
                            const newAgreementList = agreementList.filter(n => true);
                            this._controlModel.setProperty(path, newAgreementList);
                            this._controlModel.setProperty("/partners/agreements/hasChanges", true);
                            deletions.push(oObject.Id);
                        }
                    }.bind(this)
                });
            },

            // Toggle to change mode
            onEdit: function() {
                this._toggleMode();
            },

            // Read agreements for current selected partner
            onPatternMatched: function (oEvent) {
                // Populate JSON model context
                this._agreements = this._controlModel.getProperty("/partners/agreements");
                this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                this._resetDeletions();
                this._controlModel.setProperty("/partners/agreements/mode", "display");

                const oDataModel = this._getModel();
                oDataModel.read("/BinaryParameters(Pid='" + 
                        this._controlModel.getProperty("/partners/pid") + "',Id='Agreements')", {
                    success: function(oData, oResponse) {
                        this._controlModel.setProperty("/partners/agreements/direction", "inbound");
                        const JSONObject = JSON.parse(window.atob(oData.Value));
                        this._parseAgreements(JSONObject);
                    }.bind(this),
                    error: function(oError) {
                        // Entry is missing so create it
                        const partners = this._controlModel.getProperty("/partners"),
                            defaults = partners.defaults.binaryParameters.find((n) => n.name === "Agreements"),
                            oDataModel = this._getModel();
                        oDataModel.create("/BinaryParameters", {
                            Pid: partners.pid,
                            Id: defaults.name,
                            ContentType: defaults.contentType,
                            Value: window.btoa(defaults.value)
                        }, {
                            success: function(oData, oResponse) {
                                this._parseAgreements(JSON.parse(window.atob(oData.Value)));
                            }.bind(this),
                            error: function(oError) {
                                MessageToast.show(this._i18nBundle.getText("agreementUpdateFailed"));
                            }.bind(this)
                        });
                    }.bind(this)
                })

                // Read any possible pre/post processing maps
                oDataModel.read("/BinaryParameters", {
                    filters: [new Filter({
                        path: "Pid",
                        operator: FilterOperator.EQ,
                        value1: "'" + this._controlModel.getProperty("/partners/pid") + "'"
                    }), new Filter({
                        path: "Id",
                        operator: FilterOperator.StartsWith,
                        value1: "'ext_'"
                    }), new Filter({
                        path: "ContentType",
                        operator: FilterOperator.EQ,
                        value1: "xsl"
                    })]
                });
            },

            // Save current agreements
            onSave: function() {
                // Get payload and execute update
                const oDataModel = this._getModel(),
                    payload = this._preparePayload(),
                    pid = this._controlModel.getProperty("/partners/pid"),
                    key = "/BinaryParameters(Pid='" + pid + "',Id='Agreements')",
                    context = {
                        success: function(oData, oResponse) {
                            const configuration = JSON.parse(JSON.stringify(this._agreements.newConfiguration));
                            this._controlModel.setProperty("/partners/agreements/originalConfiguration", configuration);
                            this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                            this._resetDeletions();
                            this._populateAvailableAgreements();
                            this._controlModel.setProperty("/partners/agreements/mode", "display");
                        }.bind(this),
                        error: function(oError) {
                            const original = JSON.parse(JSON.stringify(this._agreements.originalConfiguration));
                            this._controlModel.setProperty("/partners/agreements/newConfiguration", original);
                            this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                            this._resetDeletions();
                            this._populateAvailableAgreements();
                            this._controlModel.setProperty("/partners/agreements/mode", "display");
                            MessageToast.show(this._i18nBundle.getText("agreementUpdateFailed"));
                        }.bind(this)
                    };

                // Evaluate if any extra deletions are required
                const haveExtraDeletions = this._extraDeletionsRequired();

                // Update agreements
                oDataModel.update(key, {
                    ContentType: "json",
                    Value: payload
                }, {
                    success: function (oData, oResponse) {
                        this.success(oData, oResponse);
                    }.bind(context),
                    error: function (oError) {
                        this.error(oError);
                    }.bind(context),
                    groupId: haveExtraDeletions ? "deferred" : undefined,
                    merge: false
                });

                // Delete extended maps that are marked inactive or where agreement was
                // removed entirely
                const deletions = this._controlModel.getProperty("/partners/agreements/extraDeletions");
                for(const deletion of deletions) {
                    const key = "/BinaryParameters(Pid='" + pid + "',Id='" + deletion + "')";
                    oDataModel.remove(key, {
                        groupId: "deferred"
                    });
                }

                // Submit changes
                oDataModel.submitChanges({
                    groupId: "deferred",
                    success: function (oData, oResponse) {
                        this.success(oData, oResponse);
                    }.bind(context),
                    error: function (oError) {
                        this.error(oError);
                    }.bind(context),
                });           
            },

            // Record selection into JSON model
            onSelect: function(oEvent) {
                const direction = this._oView.byId("agreementTabs").getSelectedKey(),
                    key = oEvent.getParameter("selectedItem").getSelectedKey();
                
                if(direction === "outbound") {
                    const archiveActive = this._getArchiveActive(this._getX12Parts(key).x12Type);
                    this._controlModel.setProperty("/partners/agreements/newEntry/archiveMessage", archiveActive);
                    this._controlModel.setProperty("/partners/agreements/newEntry/canChangeArchive", archiveActive);
                }
            },
        
            // Switch of direction choice
            onSwitch: function(oEvent) {
                this._controlModel.setProperty("/partners/agreements/direction", oEvent.getParameter("selectedKey"));
            },

            // Upload extended map
            onUpload: function(oEvent) {
                // Get file and message key information
                const file = oEvent.getParameter("files")[0],
                    sPath = oEvent.getSource().getParent().getParent().getBindingContext("control").getPath(),
                    oObject = this._controlModel.getProperty(sPath);

                // Execute upload
                this._uploadExtendedMap(file, oObject);
                oEvent.getSource().setValue("");
            },

            // Close agreement dialog
            _closeDialog: function() {
                this._oDialog.close();
            },

            // Determine if any extra deletions are required
            _extraDeletionsRequired: function() {
                const oDataModel = this._getModel(),
                    pid = this._controlModel.getProperty("/partners/pid"),
                    deletions = JSON.parse(JSON.stringify(
                                            this._controlModel.getProperty("/partners/agreements/extraDeletions")));

                // Check inbound changes first
                for(const inbound of this._agreements.newConfiguration.inbound) {
                    const id = "ext_" + inbound.message + "_preproc",
                        key = "/BinaryParameters(Pid='" + pid + "',Id='" + id + "')",
                        oObject = oDataModel.getObject(key);
                    if(oObject && !inbound.doExtendedPreProcessing) {
                        deletions.push(oObject.Id);
                    }
                }

                // Check outbound changes
                for(const outbound of this._agreements.newConfiguration.outbound) {
                    const id = "ext_" + outbound.message + "_postproc",
                        key = "/BinaryParameters(Pid='" + pid + "',Id='" + id + "')",
                        oObject = oDataModel.getObject(key);
                    if(oObject && !inbound.doExtendedPostProcessing) {
                        deletions.push(oObject.Id);
                    }
                }

                // Update model and return answer
                this._controlModel.setProperty("/partners/agreements/extraDeletions", deletions);
                return deletions.length > 0;
            },

            // Determine if archiving is active for an outbound message type
            _getArchiveActive: function(x12Type) {
                const oDataModel = this.getOwnerComponent().getModel("messages"),
                    Id = this._controlModel.getProperty("/self/pid"),
                    propertiesList = oDataModel.getProperty("/");
                for(const property in propertiesList) {
                    const oObject = oDataModel.getObject("/" + property);
                    if(oObject.Pid === Id && oObject.Id === x12Type) {
                        const config = JSON.parse(window.atob(oObject.Value));
                        return config.Outbound.ArchiveMessage === "true";
                    }
                }
                return false;
            },

            // Get list of available agreements
            _getAvailableAgreements: function() {
                // Retrieve available maps
                const inboundMaps = this._controlModel.getProperty("/maps/inbound").map((n) => n),
                    outboundMaps = this._controlModel.getProperty("/maps/outbound").map((n) => n),
                    remaining = {
                        inbound: [],
                        outbound: []
                    };

                // Parse inbound agreements
                for(const inbound of this._agreements.newConfiguration.inbound) {
                    const index = inboundMaps.map((n) => n.message).indexOf(inbound.message);
                    if(index > -1) {
                        delete inboundMaps[index];
                    }
                }
                remaining.inbound = inboundMaps.filter((n) => true);

                // Parse outbound agreements
                for(const outbound of this._agreements.newConfiguration.outbound) {
                    const index = outboundMaps.map((n) => n.message).indexOf(outbound.message);
                    if(index > -1) {
                        delete outboundMaps[index];
                    }
                }
                remaining.outbound = outboundMaps.filter((n) => true);

                return remaining;
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("partner");
            },

            // Get X12 Parts
            _getX12Parts: function(message) {
                const x12Parts = message.replaceAll("ASC-X12_", "").split("_");
                return {
                    message: message,
                    x12Type: x12Parts[0],
                    x12Version: x12Parts[1]
                };
            },

            // Open dialog for agreement maintenance
            _openDialog: function() {
                // Display dialog
                this._pDialog.then(function(oDialog) {
                    this._oDialog = oDialog;
                    this._oDialog.open();
                }.bind(this));
            },

            // Parse agreements data for display in UI
            _parseAgreements(JSONObject) {
                const inbound = JSONObject.Agreements.Inbound,
                    outbound = JSONObject.Agreements.Outbound,
                    inboundUI = [],
                    outboundUI = [];

                // Parse inbound information
                for(const message of inbound) {
                    var messageUI = this._getX12Parts(message.Message);
                    messageUI.doExtendedPreProcessing = message.DoExtendedPreProcessing === "true";
                    inboundUI.push(messageUI);
                }

                // Parse outbound information
                for(const message of outbound) {
                    var messageUI = this._getX12Parts(message.Message);
                    messageUI.doExtendedPostProcessing = message.DoExtendedPostProcessing === "true";
                    messageUI.acknowledgementRequired = message.AcknowledgementRequired === "true";
                    messageUI.archiveMessage = message.ArchiveMessage === "false" 
                                                ? false : this._getArchiveActive(messageUI.x12Type);
                    messageUI.canChangeArchive = this._getArchiveActive(messageUI.x12Type);
                    outboundUI.push(messageUI);
                }

                // Record configuration into JSON model after cloning
                const newConfiguration = {
                    inbound: inboundUI,
                    outbound: outboundUI
                },
                    originalConfiguration = JSON.parse(JSON.stringify(newConfiguration));
                this._controlModel.setProperty("/partners/agreements/newConfiguration", newConfiguration);
                this._controlModel.setProperty("/partners/agreements/originalConfiguration", originalConfiguration);

                // Populate available agreements
                this._populateAvailableAgreements();
            },

            // Determine if there are any available agreements
            _populateAvailableAgreements: function() {
                // Populate available agreements into JSON model for dynamic add button
                const availableList = this._getAvailableAgreements(),
                    available = {
                        inbound: [],
                        outbound: []
                    };
                for(const possibleInbound of availableList.inbound) {
                    available.inbound.push({
                        message: possibleInbound.message
                    });
                }
                for(const possibleOutbound of availableList.outbound) {
                    available.outbound.push({
                        message: possibleOutbound.message
                    });
                }
                this._controlModel.setProperty("/partners/agreements/available", available);
            },

            // Prepare payload for saving
            _preparePayload: function() {
                var payload = {
                    Agreements: {
                        Inbound: [],
                        Outbound: []
                    }
                };

                // Parse inbound agreements
                for(const inbound of this._agreements.newConfiguration.inbound) {
                    const message = {
                        Message: inbound.message,
                        DoExtendedPreProcessing: inbound.doExtendedPreProcessing.toString()
                    };
                    payload.Agreements.Inbound.push(message);
                }

                // Parse outbound agreements
                for(const outbound of this._agreements.newConfiguration.outbound) {
                    const message = {
                        Message: outbound.message,
                        DoExtendedPostProcessing: outbound.doExtendedPostProcessing.toString(),
                        AcknowledgementRequired: outbound.acknowledgementRequired.toString(),
                        ArchiveMessage: outbound.archiveMessage ? undefined : 
                                            outbound.archiveMessage.toString()
                    };
                    payload.Agreements.Outbound.push(message);
                }

                // Convert to JSON string and then base64
                return window.btoa(JSON.stringify(payload));
            },

            // Reset deletions list
            _resetDeletions: function() {
                this._controlModel.setProperty("/partners/agreements/extraDeletions", []);
            },

            // Save extended map to partner directory
            _saveExtendedMap: function(file, oObject) {
                // Get map stream and parameters required for update of extended map
                const mapping = file.currentTarget.result,
                    oDataModel = this._getModel(),
                    direction = this._controlModel.getProperty("/partners/agreements/direction"),
                    pid = this._controlModel.getProperty("/partners/pid"),
                    id = direction === "inbound" ? "ext_" + oObject.message + "_preproc" :
                                                    "ext_" + oObject.message + "_postproc",
                    key = "/BinaryParameters(Pid='" + pid + "',Id='" + id + "')",
                    oExtendedMap = oDataModel.getObject(key);
                
                // Check if extended map exists or not for create or update
                if(!oExtendedMap) {
                    oDataModel.create("/BinaryParameters", {
                        Pid: pid,
                        Id: id,
                        ContentType: "xsl",
                        Value: window.btoa(mapping)
                    }, {
                        success: function(oData, oResonse) {
                            MessageToast.show(this._i18nBundle.getText("extendedMapUpdateSuccessful"));
                        }.bind(this),
                        error: function(oError) {
                            MessageToast.show(this._i18nBundle.getText("extendedMapUpdateFailed"));
                        }.bind(this)
                    });
                } else {
                    oDataModel.update(key, {
                        ContentType: "xsl",
                        Value: window.btoa(mapping)
                    }, {
                        success: function(oData, oResonse) {
                            MessageToast.show(this._i18nBundle.getText("extendedMapUpdateSuccessful"));
                        }.bind(this),
                        error: function(oError) {
                            MessageToast.show(this._i18nBundle.getText("extendedMapUpdateFailed"));
                        }.bind(this),
                        merge: false
                    });
                }  
            },

            // Toggle display/change mode
            _toggleMode: function() {
                // Toggle edit mode based on current value
                const mode = this._agreements.mode === "display" ? "change" : "display";
                this._controlModel.setProperty("/partners/agreements/mode", mode);
            },

            // Read file information and upload extended map
            _uploadExtendedMap: function(file, oObject) {
                const oReader = new FileReader();
                oReader.onload = function(file) {
                    // Save extended map
                    this._saveExtendedMap(file, oObject);
                }.bind(this)

                // Read file and reset value for uploader button
                oReader.readAsText(file);
            }
        });
    });