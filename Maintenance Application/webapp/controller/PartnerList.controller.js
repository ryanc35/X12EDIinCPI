sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, BusyIndicator, MessageBox, MessageToast, Filter, FilterOperator) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.PartnerList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control");
                this._self = this._controlModel.getProperty("/self");
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
                this._oView = this.getView();

                // Create partners model
                const oDataModel = this.getOwnerComponent().getModel("partners");
                oDataModel.setDeferredGroups(["changes", "deferred"]);
                oDataModel.attachBatchRequestSent(function() {
                    this.getOwnerComponent().loadStarted(this);
                }.bind(this)).attachBatchRequestCompleted(function() {
                    this.getOwnerComponent().loadComplete(this);
                }.bind(this));
                this._metadataLoaded ??= oDataModel.metadataLoaded();
                this._metadataLoaded.then(function(oPromise) {
                    // Trigger partner load
                    this._loadPartners();
                
                    // Read list of alternative partners and agreements
                    this._getModel().read("/AlternativePartners");
                    this._readAgreements();
                }.bind(this));

                // Instantiate dialog object for possible partner creation flow
                this._pDialog ??= this.loadFragment({
                    name: "com.at.pd.edi.attr.pdediattr.view.PartnerCreate",
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
                            this._loadPartners();
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
                for(const field of this._partners.defaults) {
                    oDataModel.create("/StringParameters", {
                        Pid: dialogEntry.id,
                        Id: field.name,
                        Value: field.value
                    }, {
                        groupId: "deferred"
                    });
                }

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

            // Cancel self partner creation
            onCancelAddPartner: function() {
                this._oDialog.close();
            },

            // Delete partner
            onDelete: function (oEvent) {
                // Get identifying context for removal
                const oContext = oEvent.getSource().getObjectBinding("control")
                    .getContext(),
                    context = {
                        i18nText: this._i18nBundle.getText("partnerDeletionFailed"),
                        JSONModel: this._controlModel,
                        oDataModel: this._getModel(),
                        Pid: oContext.getObject().Pid,
                        sPath: oContext.getPath()
                    };

                // Confirm deletion first
                MessageBox.warning(this._i18nBundle.getText("partnerDeleteQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.CANCEL) {
                            // Continue deleting record
                            BusyIndicator.show(0);
                            const key = this.oDataModel.createKey("/Partners", {
                                Pid: this.Pid
                            });
                            this.oDataModel.remove(key, {
                                success: function (oData, oResponse) {
                                    const path = this.sPath.match(/.*(?=\/.*$)/)[0],
                                        index = this.sPath.match(/[^\/]+$/)[0],
                                        partners = this.JSONModel.getProperty(path).map((n) => n);
                                    delete partners[index];
                                    const newPartners = partners.filter(n => true);
                                    this.JSONModel.setProperty(path, newPartners);
                                    BusyIndicator.hide();
                                }.bind(this),
                                error: function (oError) {
                                    BusyIndicator.hide();
                                    MessageToast.show(this.i18nText);
                                }.bind(this)
                            });
                        }
                    }.bind(context)
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
                oItem.setSelected(false);
                this.getOwnerComponent().getRouter().navTo("partner");
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("partners");
            },

            // Load partner into model
            _loadPartners: function () {
                // Get model
                const oDataModel = this._getModel();

                // Prepare binding context
                const context = {
                    oDataModel: oDataModel,
                    success: function (oData, oResponse) {
                        // Check for matching self Id
                        const selfId = this._controlModel.getProperty("/self/pid").toString();
                        for (let i = 0; i < oData.results.length; i++) {
                            if (oData.results[i].Pid === selfId) {
                                this._controlModel.setProperty("/self/exists", true);
                                break;
                            }
                        }
                        this._controlModel.setProperty("/partners/list", oData.results);
                        this._context.oDataModel.setUseBatch(true);
                        this.getOwnerComponent().loadComplete(this);
                    }.bind(this),
                    error: function (oError) {
                        this._context.oDataModel.setUseBatch(true);
                        this.getOwnerComponent().loadComplete(this);
                        MessageToast.show(this._i18nBundle.getText("partnerLoadFailed"));
                    }.bind(this)
                };
                this._context = context;

                // Explicit read because /Partners returns all records ALWAYS
                oDataModel.read("/Partners", {
                    success: function (oData, oResponse) {
                        this.success(oData, oResponse);
                    }.bind(context),
                    error: function (oError) {
                        this.error(oError);
                    }.bind(context)
                });
            },

            // Get list of partner agreements for display
            _readAgreements: function() {
                // Create message model and read data
                const oDataModel = this._getModel();
                oDataModel.read("/BinaryParameters", {
                    filters: [new Filter({
                        path: "Id",
                        operator: FilterOperator.Contains,
                        value1: "'Agreements'"
                    }), new Filter({
                        path: "ContentType",
                        operator: FilterOperator.EQ,
                        value1: "json"
                    })]
                })
            }
        });
    });