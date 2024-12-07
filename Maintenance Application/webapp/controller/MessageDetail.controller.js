sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, BusyIndicator, MessageBox, MessageToast) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.MessageList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Add handler for route pattern match - for update of select list in case
                // of changes
                const route = this.getOwnerComponent().getRouter().getRoute("message");
                route.attachPatternMatched(this.onPatternMatched, this);
            },

            // Go back
            onBack: function () {
                // Navigate back
                this.getOwnerComponent().getRouter().navTo("self");
            },

            // Cancel action
            onCancel: function () {
                if (this._message.mode === "create") {
                    this.onBack();
                } else {
                    this._oView.byId("inboundTarget").setValueState("None");
                    this._swapConfiguration("/message/newConfiguration", this._message.originalConfiguration);
                    this._toggleMode();
                }
            },

            // Toggle mode
            onEdit: function () {
                this._toggleMode();
            },

            // Remove enabled messages from list of all
            // types
            onPatternMatched: function (oEvent) {
                // Populate JSON model context
                this._message = this._controlModel.getProperty("/message");

                // Get list of messages
                const oDataModel = this._getModel(),
                    messageList = oDataModel.getProperty("/"),
                    types = this._controlModel.getProperty("/x12/types").map((n) => n);

                // Remove existing entries
                for (const message in messageList) {
                    const oMessage = oDataModel.getObject("/" + message),
                        index = types.map(n => n.type).indexOf(oMessage.Id);
                    delete types[index];
                };

                // Filter empties and update model
                const newTypes = types.filter(n => true);
                this._controlModel.setProperty("/x12/availableTypes", newTypes);
            },

            // Save message
            onSave: function (oEvent) {
                // Trigger enter for validation to ensue (before saving)
                // if inbound is active
                const oDataModel = this._getModel(),
                    selfId = this._controlModel.getProperty("/self/pid"),
                    mode = this._message.mode,
                    configuration = this._message.newConfiguration,
                    original = this._message.originalConfiguration,
                    type = mode === "create" ? this._oView.byId("messageType").getSelectedItem().getKey() :
                        this._message.type,
                    targetValueState = this._oView.byId("inboundTarget").getValueState();

                // Inbound requires target IDoc (except 997s)
                if (configuration.isInboundActive && targetValueState === "Error" &&
                    type !== '997') {
                    return;
                }

                // Show error if neither direction is selected
                if (!configuration.isInboundActive && !configuration.isOutboundActive) {
                    MessageBox.error(this._i18nBundle.getText("directionRequired"));
                    return;
                }

                // Prepare value field for payload
                const JSONObject = {
                    Inbound: configuration.isInboundActive ? {
                        Target: configuration.target
                    } : undefined,
                    Outbound: configuration.isOutboundActive ? {
                        ArchiveMessage: configuration.enableArchive.toString()
                    } : undefined
                },
                    value = window.btoa(JSON.stringify(JSONObject));

                // Generate create/update requests in OData model
                const context = this._getSaveContext(mode, type, configuration, original);
                if (mode === "create") {
                    BusyIndicator.show(0);
                    oDataModel.create("/BinaryParameters", {
                        Pid: selfId,
                        Id: type,
                        Value: value,
                        ContentType: "json"
                    }, {
                        success: function (oData, oResponse) {
                            context.success(oData, oResponse);
                        },
                        error: function (oError) {
                            context.error(oError);
                        }
                    });
                } else {
                    if (this._compareConfigurations(configuration, original)) {
                        this._toggleMode();
                        MessageToast.show(this._i18nBundle.getText("noUpdateRequired"));
                        return;
                    }
                    BusyIndicator.show(0);
                    const key = "/BinaryParameters(Pid='" + selfId + "',Id='" + type + "')";
                    oDataModel.update(key, {
                        Value: value,
                        ContentType: "json"
                    }, {
                        success: function (oData, oResponse) {
                            context.success(oData, oResponse);
                        },
                        error: function (oError) {
                            context.error(oError);
                        },
                        merge: false
                    });
                }
            },

            // Trigger recording of x12 type
            onSelect: function(oEvent) {
                this._controlModel.setProperty("/message/type", oEvent.getParameter("selectedItem").getKey());
            },

            // Trigger enter for validation to ensue
            triggerEnterKey: function(oEvent) {
                oEvent.getSource().onsapenter(oEvent);
            },

            // Compare configurations to see if any changes have been made
            _compareConfigurations: function (current, original) {
                return current.isInboundActive === original.isInboundActive &&
                    current.target === original.target &&
                    current.isOutboundActive === original.isOutboundActive &&
                    current.enableArchive === original.enableArchive;
            },

            // Get model for view
            _getModel: function () {
                return this.getOwnerComponent().getModel("messages");
            },

            // Get save context
            _getSaveContext: function (mode, type, configuration, original) {
                var context = {};
                if (mode === "create") {
                    context.success = function(oData, oResponse) {
                        this._controlModel.setProperty("/message/type", type);
                        // Clone to avoid direct reference
                        this._swapConfiguration("/message/originalConfiguration", configuration);
                        this._toggleMode();
                        BusyIndicator.hide();
                    }.bind(this);
                    context.error = function(oError) {
                        BusyIndicator.hide();
                        MessageToast.show(this._i18nBundle.getText("messageCreationFailed"));

                    }.bind(this);
                } else {
                    context.success = function(oData, oResponse) {
                        // Clone to avoid direct reference
                        this._swapConfiguration("/message/originalConfiguration", configuration);
                        this._toggleMode();
                        BusyIndicator.hide();
                    }.bind(this);
                    context.error = function(oError) {
                        // Clone to avoid direct reference
                        this._swapConfiguration("/message/newConfiguration", original);
                        this._toggleMode();
                        BusyIndicator.hide();
                        MessageToast.show(this._i18nBundle.getText("messageUpdateFailed"));
                    }.bind(this);
                }
                return context;
            },

            // Swap configuration
            _swapConfiguration: function(target, configuration) {
                const newConfiguration = JSON.parse(JSON.stringify(configuration));
                this._controlModel.setProperty(target, newConfiguration);
            },

            // Toggle mode
            _toggleMode: function () {
                var current = this._message.mode;
                current = current === "display" ? "change" : "display";
                this._controlModel.setProperty("/message/mode", current);
            }
        });
    });