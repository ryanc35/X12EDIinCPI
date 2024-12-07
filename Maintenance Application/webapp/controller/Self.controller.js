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

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.Self", {
            onInit: function () {
                // Initialize additional parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                oDataModel.setDeferredGroups(["changes", "deferred"]);
                oDataModel.attachBatchRequestSent(function() {
                    this.getOwnerComponent().loadStarted(this);
                }.bind(this)).attachBatchRequestCompleted(function(oEvent) {
                    // Check for any messages and create missing entries if status code is 404
                    // SHOULD only happen if something has been deleted via other means, but 
                    // only if self partner exists
                    const exists = this._controlModel.getProperty("/self/exists"),
                        messages = oEvent.getSource().getMessagesByEntity("/StringParameters");
                    if(exists) {
                        for(const message of messages) {
                            if(message.technicalDetails.statusCode === "404") {
                                const target = message.getTarget(),
                                id = target.match(/(?<=Id=')[^']+/)[0],
                                defaults = this._self.defaults.find((n) => n.name === id);
                                oDataModel.create("/StringParameters", {
                                    Pid: target.match(/(?<=Pid=')[^']+/)[0],
                                    Id: id,
                                    Value: defaults ? defaults.value : ""
                                }, {
                                    groupId: "deferred"
                                });
                            }
                        }
                    }
                    if(oDataModel.hasPendingChanges(true)) {
                        oDataModel.submitChanges({
                            groupId: "deferred"
                        });
                    } else {
                        this.getOwnerComponent().loadComplete(this);
                    }
                }.bind(this));

                // Handle promise evaluation for metadata, control model, and
                // partner data load completion
                this._pMetadataLoaded ??= oDataModel.metadataLoaded();
                this._pMetadataLoaded.then(function(oPromise) {
                    this._pControlLoaded ??= this._controlModel.dataLoaded();
                    this._pControlLoaded.then(function(oPromise) {
                        this._self = this._controlModel.getProperty("/self");
                        this._pPartnersLoaded = this.getOwnerComponent().partnersLoaded();
                        this._pPartnersLoaded.then(function(oPromise) {
                            this._doElementBinding();
                        }.bind(this));
                    }.bind(this));
                }.bind(this));

                // Instantiate dialog object in case partner information isn't created yet
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.PartnerDialog",
                    type: "XML"
                });

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("self");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Open add dialog
            onAdd: function() {
                this._controlModel.setProperty("/createPartnerDialog/", {
                    mode: "self",
                    id: this._self.pid,
                    client: ""
                });

                // Display dialog
                this._pDialog.then(function(oDialog) {
                    this._oDialog = oDialog;
                    this._oDialog.open();
                }.bind(this));
            },

            // Add self partner to directory
            onAddPartner: function() {
                const oDataModel = this._getModel(),
                    dialogEntry = this._controlModel.getProperty("/createPartnerDialog"),
                    context = {
                        success: function(oData, oError) {
                            this._controlModel.setProperty("/self/exists", true);
                            this._doElementBinding();
                            BusyIndicator.hide();
                            this._oDialog.close();
                        }.bind(this),
                        error: function(oError) {
                            BusyIndicator.hide();
                            this._oDialog.close();
                            MessageToast.show(this._i18nBundle.getText("selfCreationFailed"))
                        }.bind(this)
                    }

                // Add authorized user
                oDataModel.create("/AuthorizedUsers", {
                        User: dialogEntry.clientId,
                        Pid: this._self.pid
                    }, {
                        groupId: "deferred"
                    }
                );

                // Add all default entries for string parameters
                for(const field of this._self.defaults) {
                    oDataModel.create("/StringParameters", {
                        Pid: dialogEntry.id,
                        Id: field.name,
                        Value: field.value
                    }, {
                        groupId: "deferred"
                    });
                }

                // Submit changes
                BusyIndicator.show(0);
                oDataModel.submitChanges({
                    groupId: "deferred",
                    success: function(oData, oResponse) {
                        context.success(oData, oResponse);
                    },
                    error: function(oError) {
                        context.error(oError);
                    }
                })                    
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
                        this._toggleMode();
                    }.bind(this));
                } else {
                    this._toggleMode();
                }
            },

            // Cancel self partner creation
            onCancelAddPartner: function() {
                this._oDialog.close();
            },

            // Toggle to change mode
            onEdit: function() {
                this._toggleMode();
            },

            // Populate JSON model context
            onPatternMatched: function(oEvent) {
                this._self = this._controlModel.getProperty("/self");
            },

            // Save changes to model
            onSave: function() {
                // Ignore request if any input field is in value state error
                if(this._hasErrorStates()) {
                    return;
                }

                // Submit updates if they exist
                const oDataModel = this._getModel();
                if(oDataModel.hasPendingChanges()) {
                    BusyIndicator.show(0);
                    oDataModel.submitChanges({
                        success: function(oData, oResponse) {
                            this._toggleMode();
                            BusyIndicator.hide();
                        }.bind(this),
                        error: function(oError) {
                            this._toggleMode();
                            BusyIndicator.hide();
                            MessageToast.show(this._i18nBundle.getText("ownPropertiesUpdateFailed"));
                        }.bind(this)
                    });
                } else {
                    // Nothing pending so switch mode to display
                    this._toggleMode();
                    MessageToast.show(this._i18nBundle.getText("noUpdateRequired"));
                }
            },

            // Trigger enter for validation to ensue
            triggerEnterKey: function(oEvent) {
                oEvent.getSource().onsapenter(oEvent);
            },

            // Execute element binding
            _doElementBinding: function() {
                // Read data and bind properties
                for(const parameter of this._self.stringParameters) {
                    const sPath = "/StringParameters(Pid='" + this._self.pid + "',Id='" 
                                                            + parameter.name + "')",
                        oField = this._oView.byId(parameter.name + "-" + parameter.mode);
                    oField.bindElement("self>" + sPath);
                }
            },

            // Get model for view
            _getModel: function() {
                return this.getOwnerComponent().getModel("self");
            },

            // Check for error states on input fields
            _hasErrorStates: function() {
                for(const input of this._self.inputs) {
                    const oField = this._oView.byId(input);
                    if(oField.getValueState() === "Error") {
                        return true;
                    }
                }
                return false;
            },
            
            // Toggle display/change mode
            _toggleMode: function() {
                // Toggle edit mode based on current value
                const mode = this._self.mode === "display" ? "change" : "display";
                this._controlModel.setProperty("/self/mode", mode);
            }
        });
    });