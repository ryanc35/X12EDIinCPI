sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter", 
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/ui/model/Sorter"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, BusyIndicator, Filter, FilterOperator, MessageBox, Sorter) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.MessageList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                oDataModel.attachBatchRequestSent(function() {
                    this.getOwnerComponent().loadStarted(this);
                }.bind(this)).attachBatchRequestCompleted(function() {
                    this.getOwnerComponent().loadComplete(this);
                }.bind(this));
                this._pMetadataLoaded ??= oDataModel.metadataLoaded();
                this._pMetadataLoaded.then(function(oPromise) {
                    this._pControlLoaded ??= this._controlModel.dataLoaded();
                    this._pControlLoaded.then(function(oPromise) {
                        // Bind items in list
                        this._id = this._controlModel.getProperty("/self/pid");
                        this._oList = this._oView.byId("messageList");
                        const oTemplate = this.oView.byId("messageItemTemplate"),
                            sorters = [new Sorter({
                                path: "Id"
                            })],
                            filters = [new Filter({
                                path: "Pid",
                                operator: FilterOperator.EQ,
                                value1: "'" + this._id + "'"
                            }), new Filter({
                                path: "ContentType",
                                operator: FilterOperator.EQ,
                                value1: "json"
                            })];
                        this._oList.bindItems({
                            path: "messages>/BinaryParameters",
                            template: oTemplate,
                            templateShareable: false,
                            sorter: sorters,
                            filters: filters
                        });
                    }.bind(this));
                }.bind(this));
            },

            // Add message
            onAdd: function() {
                // Set context for detail view
                const context = {
                    mode: "create",
                    newConfiguration: {
                        isInboundActive: false,
                        target: "",
                        isOutboundActive: false,
                        enableArchive: false
                    }
                };
                this._controlModel.setProperty("/message/", context);

                // Navigate to detail page
                this.getOwnerComponent().getRouter().navTo("message");
            },

            // Delete message
            onDelete: function(oEvent) {
                // Get identifying context for removal
                const oContext = oEvent.getSource().getObjectBinding("messages")
                                        .getContext(),
                    oDataModel = this._getModel(),
                    sPath = oContext.getPath(),
                    context = {
                        success: function(oData, oResponse) {
                            BusyIndicator.hide();
                        },
                        error: function(oError) {
                            BusyIndicator.hide();
                            MessageToast.show(this._i18nBundle.getText("messageDeletionFailed"))
                        }.bind(this)
                    };
                
                // Confirm deletion first
                MessageBox.warning(this._i18nBundle.getText("sureQuestion"), {
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {
                        if(sAction !== MessageBox.Action.CANCEL) {
                            // Continue deleting record
                            BusyIndicator.show(0);
                            oDataModel.remove(sPath, {
                                success: function(oData, oResponse) {
                                    context.success(oData, oResponse);
                                },
                                error: function(oError) {
                                    context.error(oError);
                                }
                            });
                        }
                    }
                });
            },

            // Item selection - get key for navigation to detail display
            onSelect: function(oEvent) {
                // Get message key information for data retrieval
                const oItem  =  oEvent.getParameter("listItem"),
                    oMessage = oItem.getBindingContext("messages").getObject(),
                    JSONObject = JSON.parse(window.atob(oMessage.Value)),
                    configuration = {
                        isInboundActive: JSONObject.Inbound !== undefined ? true : false,
                        target: JSONObject.Inbound !== undefined ? JSONObject.Inbound.Target.slice() : "",
                        isOutboundActive: JSONObject.Outbound !== undefined ? true : false,
                        enableArchive: JSONObject.Outbound !== undefined 
                                        ? (JSONObject.Outbound.ArchiveMessage === "true" ? true : false) : false
                    },
                    context = {
                        mode: "display",
                        type: oMessage.Id,
                        originalConfiguration: configuration,
                        newConfiguration: JSON.parse(JSON.stringify(configuration))
                    };
                this._controlModel.setProperty("/message/", context);

                // Remove selection and then navigate to detail page
                oItem.getParent().removeSelections(true);
                this.getOwnerComponent().getRouter().navTo("message");
            },

            // Decode base64 to provide viewable information
            _formatDirection: function(sDirection) {
                if(sDirection !== null) {
                    const message = JSON.parse(window.atob(sDirection));

                    // Return formatted string
                    const outbound = this._i18nBundle.getText("outbound");
                    var sValue = message.Inbound !== undefined 
                            ? this._i18nBundle.getText("inbound") : "";
                    sValue += message.Outbound !== undefined 
                            ? (sValue !== "" ? ", " + outbound : outbound) : "";
                    return sValue;
                }
            },

            // Get model for view
            _getModel: function() {
                return this.getOwnerComponent().getModel("messages");
            }
        });
    });