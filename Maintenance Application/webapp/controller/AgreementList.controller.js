sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, MessageBox, MessageToast) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.AgreementList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Instantiate dialog object for possible alternative partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.AgreementCreate",
                    type: "XML"
                });

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("partner");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Open add dialog
            onAdd: function() {
                // Generate list of available agreements
                const availableList = this._getAvailableAgreements();
                var available = {
                    inbound: [],
                    outbound: []
                };
                for(const possibleAgreement of availableList) {
                    if(possibleAgreement.direction === "inbound") {
                        available.inbound.push({
                            Message: possibleAgreement.message
                        });
                    } else {
                        available.outbound.push({
                            Message: possibleAgreement.message
                        });
                    }
                }
                this._controlModel.setProperty("/partners/agreements/available", available);
                const newEntry = this._controlModel.getProperty("/partners/agreements/newEntryCopy");
                if(available.inbound.length > 0) { 
                    newEntry.inboundMessage = available.inbound[0].Message; 
                }
                if(available.outbound.length > 0) { 
                    newEntry.outboundMessage = available.outbound[0].Message; 
                }
                this._controlModel.setProperty("/partners/agreements/newEntry", 
                                                JSON.parse(JSON.stringify(newEntry)));

                // Open agreement creation dialog
                this._openDialog();
            },

            // Add agreement to new configuration list
            onAddAgreement: function() {
                // Retrieve context information
                const key = this._oView.byId("agreementTabs").getSelectedKey(),
                    configuration = this._controlModel.getProperty("/partners/agreements/newConfiguration"),
                    entry = this._agreements.newEntry;

                // Adjust model
                var message = {
                    Message: ""
                };
                if(key === "inbound") {
                    message.Message = entry.inboundMessage;
                    message = this._getX12Parts(message);
                    message.DoExtendedPreProcessing = entry.DoExtendedPreProcessing;
                    configuration.inbound.push(message);
                } else {
                    message.Message = entry.outboundMessage;
                    message = this._getX12Parts(message);
                    message.DoExtendedPostProcessing = entry.DoExtendedPostProcessing;
                    message.AcknowledgementRequired = entry.AcknowledgementRequired;
                    message.ArchiveMessage = entry.ArchiveMessage;
                    message.canChangeArchive = this._getArchiveActive(message.x12Type);
                    configuration.outbound.push(message);
                }

                // Push changes to control model and re-determine if there are any availble
                this._controlModel.setProperty("/partners/agreements/newConfiguration", configuration);
                this._controlModel.setProperty("/partners/agreements/hasChanges", true);
                this._controlModel.setProperty("/partners/agreements/hasAvailable", this._determineHasAvailableAgreements());
                this._closeDialog();
            },

            // Record change for tracking purposes since no OData model is bound to agreements
            onChange: function() {
                this._controlModel.setProperty("/partners/agreements/hasChanges", true);
            },

            // Revert to copy of original configuration
            onCancel: function() {
                const original = JSON.parse(JSON.stringify(this._agreements.originalConfiguration));
                this._controlModel.setProperty("/partners/agreements/newConfiguration", original);
                this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                this._controlModel.setProperty("/partners/agreements/hasAvailable", this._determineHasAvailableAgreements());
            },

            // Cancel agreement addition
            onCancelAddAgreement: function() {
                this._closeDialog();
            },

            // Remove agreement from model
            onDelete: function(oEvent) {
                // Get identifying context for removal
                const sPath = oEvent.getSource().getObjectBinding("control")
                                    .getContext().getPath(),
                context = {
                    index: sPath.match(/[^\/]+$/)[0],
                    JSONModel: this._controlModel,
                    path: sPath.match(/.*(?=\/.*$)/)[0]
                };

                // Confirm deletion first
                MessageBox.warning(this._i18nBundle.getText("sureQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.CANCEL) {
                            const agreementList = this.JSONModel.getProperty(this.path);
                            delete agreementList[this.index];
                            const newAgreementList = agreementList.filter(n => true);
                            this.JSONModel.setProperty(this.path, newAgreementList);
                            this.JSONModel.setProperty("/partners/agreements/hasChanges", true);
                        }
                    }.bind(context)
                });
            },

            // Read agreements for current selected partner
            onPatternMatched: function (oEvent) {
                // Populate JSON model context
                this._agreements = this._controlModel.getProperty("/partners/agreements");

                // Read agreement information
                const key = "/BinaryParameters(Pid='" + this._controlModel.getProperty("/partners/pid")
                                                         + "',Id='Agreements')/Value",
                    oDataModel = this._getModel(),
                    sValue = oDataModel.getProperty(key);

                if(!sValue) { 
                    // Entry is missing so create it
                    const partners = this._controlModel.getProperty("/partners"),
                        defaults = partners.defaults.binaryParameters.find((n) => n.name === "Agreements");
                    oDataModel.create("/BinaryParameters", {
                        Pid: this._controlModel.getProperty("/partners/pid"),
                        Id: defaults.name,
                        ContentType: defaults.contentType,
                        Value: window.btoa(defaults.value)
                    }, {
                        success: function(oData, oError) {
                            this._parseAgreements(JSON.parse(window.atob(oData.Value)));
                        }.bind(this),
                        error: function(oError) {
                            MessageToast.show(this._i18nBundle.getText("agreementUpdateFailed"));
                        }.bind(this)
                    });
                } else {
                    const JSONObject = JSON.parse(window.atob(sValue));
                    this._parseAgreements(JSONObject);
                }
            },

            // Save current agreements
            onSave: function() {
                // Get payload and execute update
                const oDataModel = this._getModel(),
                    payload = this._preparePayload(),
                    key = "/BinaryParameters(Pid='" + this._controlModel.getProperty("/partners/pid")
                                                         + "',Id='Agreements')";

                // Update agreements
                oDataModel.update(key, {
                    ContentType: "json",
                    Value: payload
                }, {
                    success: function (oData, oResponse) {
                        const configuration = JSON.parse(JSON.stringify(this._agreements.newConfiguration));
                        this._controlModel.setProperty("/partners/agreements/originalConfiguration", configuration);
                        this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                    }.bind(this),
                    error: function (oError) {
                        const original = JSON.parse(JSON.stringify(this._agreements.originalConfiguration));
                        this._controlModel.setProperty("/partners/agreements/newConfiguration", original);
                        this._controlModel.setProperty("/partners/agreements/hasChanges", false);
                        MessageToast.show(this._i18nBundle.getText("agreementUpdateFailed"));
                    }.bind(this),
                    merge: false
                });
            },

            // Close agreement dialog
            _closeDialog: function() {
                this._oDialog.close();
            },

            // Determine if there are any available agreements
            _determineHasAvailableAgreements: function() {
                return this._getAvailableAgreements().length > 0;
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
                const maps = this._controlModel.getProperty("/maps/list").map((n) => n);

                // Parse inbound agreements
                for(const inbound of this._agreements.newConfiguration.inbound) {
                    const index = maps.map((n) => n.message).indexOf(inbound.Message);
                    if(index > -1) {
                        delete maps[index];
                    }
                }

                // Parse outbound agreements
                for(const outbound of this._agreements.newConfiguration.outbound) {
                    const index = maps.map((n) => n.message).indexOf(outbound.Message);
                    if(index > -1) {
                        delete maps[index];
                    }
                }

                return maps.filter((n) => true);
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("partners");
            },

            // Get X12 Parts
            _getX12Parts: function(message) {
                const x12Parts = message.Message.replaceAll("ASC-X12_", "").split("_");
                message.x12Type = x12Parts[0];
                message.x12Version = x12Parts[1];
                return message;
            },

            // Open dialog for agreement
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
                outbound = JSONObject.Agreements.Outbound;

                // Parse inbound information
                for(var message of inbound) {
                    message = this._getX12Parts(message);
                    message.DoExtendedPreProcessing = message.DoExtendedPreProcessing === "true";
                }

                // Parse outbound information
                for(var message of outbound) {
                    message = this._getX12Parts(message);
                    message.DoExtendedPostProcessing = message.DoExtendedPostProcessing === "true";
                    message.AcknowledgementRequired = message.AcknowledgementRequired === "true";
                    message.ArchiveMessage = message.ArchiveMessage === "false" 
                                                ? false : this._getArchiveActive(message.x12Type);
                    message.canChangeArchive = this._getArchiveActive(message.x12Type);
                }

                // Record configuration into JSON model after cloning
                const newConfiguration = {
                    inbound: inbound,
                    outbound: outbound
                },
                    originalConfiguration = JSON.parse(JSON.stringify(newConfiguration));
                this._controlModel.setProperty("/partners/agreements/newConfiguration", newConfiguration);
                this._controlModel.setProperty("/partners/agreements/originalConfiguration", originalConfiguration);

                // Determine if there are any available agreements
                this._controlModel.setProperty("/partners/agreements/hasAvailable", this._determineHasAvailableAgreements());
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
                        Message: inbound.Message,
                        DoExtendedPreProcessing: inbound.DoExtendedPreProcessing.toString()
                    };
                    payload.Agreements.Inbound.push(message);
                }

                // Parse outbound agreements
                for(const outbound of this._agreements.newConfiguration.outbound) {
                    const message = {
                        Message: outbound.Message,
                        DoExtendedPostProcessing: outbound.DoExtendedPostProcessing.toString(),
                        AcknowledgementRequired: outbound.AcknowledgementRequired.toString(),
                        ArchiveMessage: outbound.ArchiveMessage ? undefined : 
                                            outbound.ArchiveMessage.toString()
                    };
                    payload.Agreements.Outbound.push(message);
                }

                // Convert to JSON string and then base64
                return window.btoa(JSON.stringify(payload));
            }
        });
    });