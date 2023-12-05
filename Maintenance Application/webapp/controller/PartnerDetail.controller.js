sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageToast",
    "com/at/pd/edi/attr/pdediattr/model/StringyBoolean"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, BusyIndicator, MessageToast, StringyBoolean) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.PartnerDetail", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Load on init for creating bindings - overwritten onPatternMatch for each
                // navigation event
                this._partners = this._controlModel.getProperty("/partners");

                // Get model for binding batch complete listener for late arrangement 
                // of UI data visibility (adapter specific and missing parameters)
                const oDataModel = this._getModel();
                oDataModel.attachBatchRequestCompleted(this._batchCompleteListener.bind(this));

                // Instantiate dialog object for possible alternative partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.AlternativePartnerCreate",
                    type: "XML"
                }); 

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("partner");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Open add dialog
            onAdd: function() {
                // Set mode
                this._controlModel.setProperty("/alternativePartners/mode", "create");
                this._controlModel.setProperty("/partners/alternativePartnerId", "");
                this._openDialog();
            },

            // Attempt to create alternative partner
            onAddAlternativePartner: function() {
                const inputValueState = this._oView.byId("alternativePartnerInput").getValueState();
                if(inputValueState === "Error") {
                    return;
                }
                
                // Generate context for entity creation
                const oDataModel = this.getOwnerComponent().getModel("partners"),
                    id = this._partners.alternativePartnerId,
                    Pid = this._partners.pid,
                    alternativeKeys = this._controlModel.getProperty("/alternativePartners"),
                    context = {
                        success: function(oData, oResponse) {
                            this._controlModel.setProperty("/partners/alternativePartnerExists", true);
                            const key = oDataModel.createKey("/AlternativePartners", {
                                Hexagency: oData.Hexagency,
                                Hexscheme: oData.Hexscheme,
                                Hexid: oData.Hexid
                            });
                            for(const element of alternativeKeys.elements) {
                                const oField = this._oView.byId(element);
                                oField.bindElement("partners>" + key);
                            }
                            this._oDialog.close();
                            BusyIndicator.hide();
                        }.bind(this),
                        error: function(oError) {
                            this._oDialog.close();
                            BusyIndicator.hide();
                            MessageToast.show(this._i18nBundle.getText("idocIdCreationFailed"));
                        }.bind(this)
                    }

                // Submit creation
                oDataModel.create("/AlternativePartners", {
                    Agency: alternativeKeys.agency,
                    Scheme: alternativeKeys.scheme,
                    Id: id,
                    Pid: Pid 
                }, {
                    success: function(oData, oError) {
                        this.success(oData, oError);
                    }.bind(context),
                    error: function(oError) {
                        this.success(oError);
                    }.bind(context)
                });
            },

            // Handle attachment for notification to UI upon initial loading of data
            onAfterRendering: function() {
                // Read data and bind properties
                for(const parameter of this._partners.stringParameters) {
                    if(parameter.attachModelContextChange) {
                        const oField = this._oView.byId(parameter.id);
                        oField.attachModelContextChange(this.onContextChange.bind(this));
                    }
                }
            },

            // Go back
            onBack: function () {
                // reset context and navigate back
                this._controlModel.setProperty("/partners/alternativePartnerExists", false);
                this._controlModel.setProperty("/partners/alternativePartnerId", "");
                this._controlModel.setProperty("/partners/agreements", {});
                this.getOwnerComponent().getRouter().navTo("partners");
            },

            // Reject pending changes
            onCancel: function() {
                // Check for possible error states
                const oDataModel = this._getModel();
                if(this._hasErrorStates()) {
                    oDataModel.updateBindings(true);
                }

                // Reset changes to model
                if(oDataModel.hasPendingChanges()) {
                    oDataModel.resetChanges().then(function(oPromise) {
                        this._resetJSONModel();
                        this._toggleMode();
                    }.bind(this));
                } else {
                    this._toggleMode();
                }
            },

            // Cancel self partner creation
            onCancelAlternativePartnerDialog: function() {
                this._oDialog.close();
            },

            // Remove existing alternative and create new entity
            onChangeAlternativePartner: function() {
                const inputValueState = this._oView.byId("alternativePartnerInput").getValueState();
                if(inputValueState === "Error") {
                    return;
                }

                // Generate context for entity delete and following create
                const oDataModel = this.getOwnerComponent().getModel("partners"),
                    id = this._partners.alternativePartnerId,
                    Pid = this._partners.pid,
                    alternativeKeys = this._controlModel.getProperty("/alternativePartners"),
                    context = {
                        success: function(oData, oResponse) {
                            this._controlModel.setProperty("/partners/alternativePartnerExists", true);
                            const key = oDataModel.createKey("/AlternativePartners", {
                                Hexagency: oData.__batchResponses[0].__changeResponses[1].data.Hexagency,
                                Hexscheme: oData.__batchResponses[0].__changeResponses[1].data.Hexscheme,
                                Hexid: oData.__batchResponses[0].__changeResponses[1].data.Hexid,
                            });
                            for(const element of alternativeKeys.elements) {
                                const oField = this._oView.byId(element);
                                oField.bindElement("partners>" + key);
                            }
                            this._oDialog.close();
                        }.bind(this),
                        error: function(oError) {
                            this._oDialog.close();
                            MessageToast.show(this._i18nBundle.getText("idocIdUpdateFailed"));
                        }.bind(this)
                    }

                // Get entity context and initiate delete
                const sPath = this._oView.byId("sap_idoc_id-change").getBindingContext("partners").getPath();
                oDataModel.remove(sPath, {
                    groupId: "deferred"
                });

                // Create new entity
                oDataModel.create("/AlternativePartners", {
                    Agency: alternativeKeys.agency,
                    Scheme: alternativeKeys.scheme,
                    Id: id,
                    Pid: Pid 
                }, {
                    groupId: "deferred"
                });

                // Submit updates
                oDataModel.submitChanges({
                    groupId: "deferred",
                    success: function(oData, oResponse) {
                        this.success(oData, oResponse);
                    }.bind(context),
                    error: function(oError) {
                        this.error(oError);
                    }.bind(context)
                });
            },

            // Initial context without defaulting (changing) values for dependencies
            onContextChange: function(oEvent) {
                const oSource = oEvent.getSource();
                this._populateJSONModel(oSource, this._getModelConfig(oSource));
            },

            // Toggle edit mode
            onEdit: function() {
                this._toggleMode();
            },

            // Bind partner data for loading
            onPatternMatched: function (oEvent) {
                // Set root context
                this._partners = this._controlModel.getProperty("/partners");

                // Unbind IDoc ID every time so it isn't carried to a partner
                // where one has not been created yet
                const alternativeKeys = this._controlModel.getProperty("/alternativePartners");
                for(const element of alternativeKeys.elements) {
                    const oField = this._oView.byId(element);
                    oField.unbindElement("partners");
                }

                // Load partner information
                this._loadPartner();
            },

            // Open dialog for alternative partner replacement
            onReplace: function() {
                // Set mode
                this._controlModel.setProperty("/alternativePartners/mode", "change");
                this._controlModel.setProperty("/partners/alternativePartnerId", "");
                this._openDialog();
            },

            // Save partner changes
            onSave: function() {
                // Ignore request if any input field is in value state error
                if(this._hasErrorStates()) {
                    return;
                }

                // Submit updates if they exist
                const oDataModel = this._getModel();
                if(oDataModel.hasPendingChanges()) {
                    oDataModel.submitChanges({
                        success: function(oData, oResponse) {
                            this._toggleMode();
                        }.bind(this),
                        error: function(oError) {
                            this._toggleMode();
                            MessageToast.show(this._i18nBundle.getText("partnerUpdateFailed"));
                        }.bind(this)
                    });
                } else {
                    // Nothing pending so switch mode to display
                    this._toggleMode();
                    MessageToast.show(this._i18nBundle.getText("noUpdateRequired"));
                }
            },

            // Record adjustments for dependent visibility
            onSelect: function(oEvent) {
                this._handleEvent(oEvent);
            },

            // Record adjustments for dependent visibility
            onSwitch: function(oEvent) {
                this._handleEvent(oEvent);
            },

            // Trigger enter for validation to ensue
            triggerEnterKey(oEvent) {
                oEvent.getSource().onsapenter(oEvent);
            },

            // Report load completion and handle missing data
            _batchCompleteListener: function(oEvent) {
                // Set adapter into control model for conditional display
                const oDataModel = this._getModel(),
                    sAdapter = oDataModel.getProperty("/StringParameters(Pid='" + this._partners.pid + 
                                                    "',Id='AdapterType')/Value");
                this._controlModel.setProperty("/partners/view/adapter", (sAdapter) ? sAdapter : "AS2");

                // Check for any messages and create missing entries if status code is 404
                // SHOULD only happen if something has been deleted via other means
                const messages = oEvent.getSource().getMessagesByEntity("/StringParameters");
                for(const message of messages) {
                    if(message.technicalDetails.statusCode === "404") {
                        const target = message.getTarget(),
                        id = target.match(/(?<=Id=')[^']+/)[0],
                        defaults = this._partners.defaults.stringParameters.find((n) => n.name === id);
                        oDataModel.create("/StringParameters", {
                            Pid: target.match(/(?<=Pid=')[^']+/)[0],
                            Id: id,
                            Value: defaults ? defaults.value : ""
                        }, {
                            groupId: "deferred"
                        });
                    }
                }
                if(oDataModel.hasPendingChanges(true)) {
                    oDataModel.submitChanges({
                        groupId: "deferred"
                    });
                }

                // Report completion status
                this.getOwnerComponent().loadComplete(this);
            },

            // Force field update based on dependency
            _forceUpdate: function(mConfig) {
                // Base case for halting recursion
                if(!mConfig.dependents) {
                    return;
                }
                
                // Process updates for current control and any children
                for(const dependent of mConfig.dependents) {
                    // Get control and recurse children first
                    const oControl = this._oView.byId(dependent.id),
                        sType = oControl.getMetadata().getName();
                    this._forceUpdate(this._getModelConfig(oControl));

                    // Update control after children are finished and record update
                    if(sType === "sap.m.Switch") {
                        oControl.setState(dependent.value);
                    } else if(sType === "sap.m.Select") {
                        oControl.setSelectedKey(dependent.value);
                    }
                        this._populateJSONModel(oControl, mConfig);
                }
            },

            // Convert hex encoded strings
            _formatString: function(sString) {
                // Get hex string conversions for display
                const replacements = this._controlModel.getProperty("/hex");

                if(sString && sString.startsWith("#")){
                    sString = replacements[sString];
                    sString = this._i18nBundle.getText(sString);
                }
                return sString;
            },

            // Convert hex encoded strings
            _formatVerifySignature: function(sVerify) {
                switch (sVerify) {
                    case "notRequired":
                    default:
                        return "Not Required";
                    case "trustedCertificate":
                        return "Trusted Certificate";
                    case "trustedRootCertificate":
                        return "Trusted Root Certificate";
                }
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("partner");
            },

            // Get model configuration for depdencencies
            _getModelConfig: function(oSource) {
                return this._partners.stringParameters.find(
                    (n) => n.id === this._oView.getLocalId(oSource.getId()));
            },

            // Hande event
            _handleEvent: function(oEvent) {
                // Initialize parameters
                const oSource = oEvent.getSource(),
                    mConfig = this._getModelConfig(oSource);

                // Only force updates on switches that are turned false
                // but always propagate JSON model updates
                const sType = oSource.getMetadata().getName(),
                    key = sType === "sap.m.Select" ? oSource.getSelectedKey() : undefined;
                if((sType === "sap.m.Switch" && !oSource.getState()) ||
                    (sType === "sap.m.Select" && mConfig.hasTriggerKeys.find((n) => n === key))) {
                    this._forceUpdate(mConfig);
                }
                this._populateJSONModel(oSource, mConfig);
            },

            // Check for error states on input fields
            _hasErrorStates: function() {
                for(const input of this._partners.inputs) {
                    const oField = this._oView.byId(input);
                    if(oField.getValueState() === "Error") {
                        return true;
                    }
                }
                return false;
            },

            // Load partner details
            _loadPartner: function() {
                // Get model
                const oDataModel = this._getModel();

                // Read data and bind properties
                for(const parameter of this._partners.stringParameters) {
                    const sPath = "/StringParameters(Pid='" + this._partners.pid + "',Id='" 
                                                            + parameter.name + "')",
                        oField = this._oView.byId(parameter.id);
                    oField.bindElement("partner>" + sPath);
                }

                // Bind IDoc ID (alternative partners loaded in partner list generation)
                const alternativeKeys = this._controlModel.getProperty("/alternativePartners"),
                    partnersModel = this.getOwnerComponent().getModel("partners"),
                    oEntities = partnersModel.getProperty("/");

                // Check if any entity matches selected partner for binding purposes
                for (const entityPath in oEntities) {
                    const oObject = partnersModel.getObject("/" + entityPath);
                    if(oObject.Pid === this._partners.pid &&
                        oObject.Agency === alternativeKeys.agency &&
                        oObject.Scheme === alternativeKeys.scheme) {
                        for(const element of alternativeKeys.elements) {
                            this._controlModel.setProperty("/partners/alternativePartnerExists", true);
                            const oField = this._oView.byId(element);
                            oField.bindElement("partners>/" + entityPath);
                        }
                    }
                }
            },

            // Open dialog for alternative partner
            _openDialog: function() {
                // Display dialog
                this._pDialog.then(function(oDialog) {
                    this._oDialog = oDialog;
                    this._oDialog.open();
                }.bind(this));
            },

            // Populate visibility triggers into JSON Model
            _populateJSONModel: function(oSource, mConfig) {
                const sType = oSource.getMetadata().getName()
                if(sType === "sap.m.Select" && mConfig.jsonTarget) {
                    this._controlModel.setProperty(mConfig.jsonTarget, oSource.getSelectedKey());
                } else if(sType === "sap.m.Switch" && mConfig.jsonTarget) {
                    this._controlModel.setProperty(mConfig.jsonTarget, oSource.getState());
                } else if(sType === "sap.m.Input") {
                    oSource.setValueState("None");
                }
            },

            // Reset JSON model values for visibility after cancel event
            _resetJSONModel: function() {
                // Iterate fields that need reset for visibility control
                for(const field of this._partners.resetControls) {
                    const oField = this._oView.byId(field);
                    this._populateJSONModel(oField, this._getModelConfig(oField));
                }
            },

            // Toggle display/change mode
            _toggleMode: function() {
                // Toggle edit mode based on current value
                const mode = this._partners.mode === "display" ? "change" : "display";
                this._controlModel.setProperty("/partners/mode", mode);
            }
        });
    });