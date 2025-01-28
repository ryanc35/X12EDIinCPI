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

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.PartnerList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control");
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                oDataModel.setDeferredGroups(["changes", "deferred"]);
                oDataModel.attachBatchRequestSent(function() {
                    this.getOwnerComponent().loadStarted(this);
                }.bind(this)).attachBatchRequestCompleted(function() {
                    this.getOwnerComponent().loadComplete(this);
                }.bind(this));
                this._metadataLoaded ??= oDataModel.metadataLoaded();
                this._metadataLoaded.then(function(oPromise) {
                    // Trigger partner load
                    this._loadPartners().then((oData, oResponse) => {
                        // Check for matching self Id
                        const pid = this._controlModel.getProperty("/self/pid");
                        for (let i = 0; i < oData.results.length; i++) {
                            if (oData.results[i].Pid === pid) {
                                this._controlModel.setProperty("/self/exists", true);
                                break;
                            }
                        }

                        this._controlModel.setProperty("/partners/list", oData.results);
                    }).catch((oError) => {
                        MessageToast.show(this._i18nBundle.getText("partnerLoadFailed"));
                    });
                
                    // Read list of alternative partners and agreements
                    this._getModel().read("/AlternativePartners");
                    this._readCertificates();
                }.bind(this));

                // Instantiate dialog object for possible partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.PartnerDialog",
                    type: "XML"
                });  

                // Add handler for route pattern match - populate root JSON context
                const route = this.getOwnerComponent().getRouter().getRoute("partners");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Open add dialog
            onAdd: function () {
                this._controlModel.setProperty("/createPartnerDialog/", {
                    client: "",
                    id: "",
                    mode: "partner"
                });

                // Display dialog
                this._pDialog.then(function(oDialog) {
                    this._oDialog = oDialog;
                    this._oDialog.open();
                }.bind(this));
            },

            // Add partner to directory
            onAddPartner: function() {
                const oDataModel = this._getModel(),
                    dialogEntry = this._controlModel.getProperty("/createPartnerDialog"),
                    context = {
                        success: function(oData, oResponse) {
                            this._oDialog.close();
                            this._loadPartners().then((oData, oResponse) => {
                                this._controlModel.setProperty("/partners/list", oData.results);
                            });
                        }.bind(this),
                        error: function(oError) {
                            this._oDialog.close();
                            MessageToast.show(this._i18nBundle.getText("partnerCreationFailed"))
                        }.bind(this)
                    }

                // Add authorized user
                oDataModel.create("/AuthorizedUsers", {
                    User: dialogEntry.clientId,
                    Pid: dialogEntry.id
                }, {
                    groupId: "deferred"
                });


                // Add all default entries for string parameters
                for(const field of this._partners.defaults.stringParameters) {
                    oDataModel.create("/StringParameters", {
                        Pid: dialogEntry.id,
                        Id: field.name,
                        Value: field.value
                    }, {
                        groupId: "deferred"
                    });
                }

                // Add all default entries for binary parameters
                for(const field of this._partners.defaults.binaryParameters) {
                    oDataModel.create("/BinaryParameters", {
                        Pid: dialogEntry.id,
                        Id: field.name,
                        ContentType: field.contentType,
                        Value: window.btoa(field.value)
                    }, {
                        groupId: "deferred"
                    });
                }

                // Submit updates
                oDataModel.submitChanges({
                    groupId: "deferred",
                    success: function(oData, oResponse) {
                        context.success(oData, oResponse);
                    },
                    error: function(oError) {
                        context.error(oError);
                    }
                });
            },

            // Cancel self partner creation
            onCancelAddPartner: function() {
                this._oDialog.close();
            },

            // Delete partner
            onDelete: function (oEvent) {
                // Get identifying context for removal
                const oContext = oEvent.getSource().getObjectBinding("control").getContext(),
                    oDataModel = this._getModel(),
                    pid = oContext.getObject().Pid,
                    sPath = oContext.getPath();

                // Confirm deletion first
                MessageBox.warning(this._i18nBundle.getText("partnerDeleteQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.CANCEL) {
                            // Continue deleting record
                            BusyIndicator.show(0);
                            const key = oDataModel.createKey("/Partners", {
                                Pid: pid
                            });
                            this._delete(key).then((oData, oResponse) => {
                                const path = sPath.match(/.*(?=\/.*$)/)[0],
                                    index = sPath.match(/[^\/]+$/)[0],
                                    partners = this._controlModel.getProperty(path).map((n) => n);
                                delete partners[index];
                                const newPartners = partners.filter(n => true);
                                this._controlModel.setProperty(path, newPartners);
                                BusyIndicator.hide();
                            }).catch((oError) => {
                                BusyIndicator.hide();
                                MessageToast.show(this._i18nBundle.getText("partnerDeletionFailed"));
                            });
                        }
                    }.bind(this)
                });
            },

            // Apply dynamic filter to table (onLiveChange)
            onFilterChange: function (oEvent) {
                const text = oEvent.getParameters().newValue,
                    filters = [];
                filters.push(new Filter({
                    path: "Pid",
                    operator: FilterOperator.Contains,
                    value1: text
                }));
                const list = this._oView.byId("partnerList");
                list.getBinding("items").filter(filters);
            },

            // Populate JSON model context
            onPatternMatched: function(oEvent) {
                this._partners = this._controlModel.getProperty("/partners");
            },

            // Refresh list
            onRefresh: function () {
                this._loadPartners();
            },

            // Item selection - get key for navigation to detail display
            onSelect: function(oEvent) {
                // Get partner key information for data retrieval
                const oItem = oEvent.getParameter("listItem"),
                    oPartner = oItem.getBindingContext("control").getObject();
                this._controlModel.setProperty("/partners/pid", oPartner.Pid);
                this._controlModel.setProperty("/partners/mode", "display");

                // Remove selection and then navigate to detail page
                oItem.getParent().removeSelections(true);
                this.getOwnerComponent().getRouter().navTo("partner");
            },

            // Delete partner
            _delete: function(key) {
                return new Promise((resolve, reject) => {
                    this._getModel().remove(key, {
                        success: function(oData, oResponse) {
                            resolve(oData, oResponse);
                        },
                        error: function(oError) {
                            reject(oError);
                        }
                    });
                });
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("partners");
            },

            // Load partner into model
            _loadPartners: function () {
                return new Promise((resolve, reject) => {
                    // Explicit read because /Partners returns all records ALWAYS
                    this._getModel().read("/Partners", {
                        success: function(oData, oResponse) {
                            resolve(oData, oResponse);
                        },
                        error: function(oError) {
                            reject(oError);
                        }
                    });
                });
            },

            // Get list of partner certificates
            _readCertificates: function() {
                // Create message model and read data
                const oDataModel = this._getModel();
                oDataModel.read("/BinaryParameters", {
                    filters: [new Filter({
                        path: "Id",
                        operator: FilterOperator.EQ,
                        value1: "'SenderPublicKey'"
                    }), new Filter({
                        path: "ContentType",
                        operator: FilterOperator.EQ,
                        value1: "crt"
                    })]
                })
            }
        });
    });