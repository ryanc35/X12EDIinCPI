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
                oDataModel.attachBatchRequestSent(function() {
                    BusyIndicator.show(0);
                }).attachBatchRequestCompleted(this._batchCompleteListener.bind(this));

                // Instantiate dialog object for possible alternative partner updates
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.AlternativePartnerDialog",
                    type: "XML"
                }); 

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("partner");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Attempt to create alternative partner
            onAddAlternativePartner: function() {
                const inputValueState = this._oView.byId("alternativePartnerInput").getValueState();
                if(inputValueState === "Error") {
                    return;
                }
                
                // Generate context for entity creation
                const oDataModel = this._getModel(),
                    id = this._partners.alternativePartnerId,
                    Pid = this._partners.pid,
                    alternativeKeys = this._controlModel.getProperty("/alternativePartners");

                // Submit creation
                oDataModel.create("/AlternativePartners", {
                    Agency: alternativeKeys.agency,
                    Scheme: alternativeKeys.scheme,
                    Id: id,
                    Pid: Pid 
                }, {
                    success: (oData, oError) => {
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
                    },
                    error: (oError) => {
                        this._oDialog.close();
                        BusyIndicator.hide();
                        MessageToast.show(this._i18nBundle.getText("idocIdCreationFailed"));
                    }
                });
            },


            // Open add alternative partner dialog
            onAddAlternativePartnerDialog: function() {
                // Set mode
                this._controlModel.setProperty("/alternativePartners/mode", "create");
                this._controlModel.setProperty("/partners/alternativePartnerId", "");
                this._openDialog();
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
                const resetConfiguration = {
                    newEntry: {},
                    newEntryCopy: {
                        acknowledgementRequired: true,
                        archiveMessage: false,
                        canChangeArchive: false,
                        doExtendedPostProcessing: false,
                        doExtendedPreProcessing: false,
                        message: ""
                    },
                };
                this._controlModel.setProperty("/partners/agreements", resetConfiguration);
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

            // Remove existing alternative and create new entity
            onChangeAlternativePartner: function() {
                const inputValueState = this._oView.byId("alternativePartnerInput").getValueState();
                if(inputValueState === "Error") {
                    return;
                }

                // Generate context for entity delete and following create
                const oDataModel = this._getModel(),
                    id = this._partners.alternativePartnerId,
                    Pid = this._partners.pid,
                    alternativeKeys = this._controlModel.getProperty("/alternativePartners"),
                    sPath = this._oView.byId("sap_idoc_id-change").getBindingContext("partners").getPath();

                // Initiate delete
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
                this._submit("deferred").then((oData, oResponse) => {
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
                }).catch((oError) => {
                    this._oDialog.close();
                    MessageToast.show(this._i18nBundle.getText("idocIdUpdateFailed"));
                });
            },

            // Cancel open dialog (alternative partner or certificate upload)
            onCloseDialog: function() {
                this._oDialog.close();
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

                // Read certificate
                const key = "/BinaryParameters(Pid='" + this._controlModel.getProperty("/partners/pid")
                                                         + "',Id='SenderPublicKey')/Value",
                    oDataModel = this.getOwnerComponent().getModel("partners"),
                    sValue = oDataModel.getProperty(key);
                this._controlModel.setProperty("/partners/hasCertificate", sValue ? true : false);

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
            onReplaceAlternativePartnerDialog: function() {
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
                if(this._getModel().hasPendingChanges()) {
                    this._submit().then((oData, oResponse) => {
                        this._toggleMode();
                    }).catch((oError) => {
                        this._toggleMode();
                        MessageToast.show(this._i18nBundle.getText("partnerUpdateFailed"));
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

            // Trigger upload of certificate
            triggerCertificateUpload: function(oEvent) {
                const file = oEvent.getParameter("files")[0],
                    oReader = new FileReader();

                // Read file stream
                oReader.onload = function(file) {
                    // Save certificate
                    this._saveCertficate(file);
                }.bind(this)

                // Read file and reset value for uploader button
                oReader.readAsText(file);
                oEvent.getSource().setValue("");
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
                } else {
                    BusyIndicator.hide();
                }
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

            // Convert key to text using i18n for translation
            _formatKey: function(sKey) {
                return this._i18nBundle.getText(sKey);
            },

            // Convert hex encoded strings
            _formatString: function(sString) {
                // Get hex string conversions for display
                const replacements = this._controlModel.getProperty("/hex");

                if((sString && sString.startsWith("#")) || sString === ""){
                    sString = replacements[sString];
                    sString = this._i18nBundle.getText(sString);
                }
                return sString;
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

            // Open dialog for alternative partner maintenance
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

            // Save certificate to partner directory
            _saveCertficate: function(file) {
                // Get core base64 content
                const fullCert = file.currentTarget.result,
                    // Remove both Windows based new lines and Mac/Unix based new lines
                    oneLineCert = fullCert.toString().replaceAll("\r\n", "").replaceAll("\n", ""),
                    onlyBase64 = 
                        oneLineCert.match(/(?<=-----BEGIN CERTIFICATE-----)(.+)(?=-----END CERTIFICATE-----)/)[0];

                // Get model and submit create or update - partners model contains certificates 
                // it's NOT the default model for this view
                const oDataModel = this.getOwnerComponent().getModel("partners"),
                    exists = this._controlModel.getProperty("/partners/hasCertificate");
                if(!exists) {
                    oDataModel.create("/BinaryParameters", {
                        Pid: this._partners.pid,
                        Id: "SenderPublicKey",
                        ContentType: "crt",
                        Value: onlyBase64
                    }, {
                        success: (oData, oResponse) => {
                            this._controlModel.setProperty("/partners/hasCertificate", true);
                            MessageToast.show(this._i18nBundle.getText("certificateUpdateSuccessful"));
                        },
                        error: (oError) => {
                            MessageToast.show(this._i18nBundle.getText("certificateUpdateFailed"));
                        }
                    });
                } else {
                    const key = "/BinaryParameters(Pid='" + this._partners.pid +
                                                    "',Id='SenderPublicKey')"
                    oDataModel.update(key, {
                        ContentType: "crt",
                        Value: onlyBase64
                    }, {
                        success: (oData, oResponse) => {
                            this._controlModel.setProperty("/partners/hasCertificate", true);
                            MessageToast.show(this._i18nBundle.getText("certificateUpdateSuccessful"));
                        },
                        error: (oError) => {
                            MessageToast.show(this._i18nBundle.getText("certificateUpdateFailed"));
                        },
                        merge: false
                    });
                }
            },

            // Submit changes
            _submit: function(groupId) {
                return new Promise((resolve, reject) => {
                    this._getModel().submitChanges({
                        groupId: groupId,
                        success: function(oData, oResponse) {
                            resolve(oData, oResponse);
                        },
                        error: function(oError) {
                            reject(oError);
                        }
                    });
                });
            },

            // Toggle display/change mode
            _toggleMode: function() {
                // Toggle edit mode based on current value
                const mode = this._partners.mode === "display" ? "change" : "display";
                this._controlModel.setProperty("/partners/mode", mode);
            }
        });
    });