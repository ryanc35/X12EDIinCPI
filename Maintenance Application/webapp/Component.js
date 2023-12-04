/**
 * eslint-disable @sap/ui5-jsdocs/no-jsdoc
 */

sap.ui.define([
        "sap/ui/core/UIComponent",
        "sap/ui/Device",
        "com/at/pd/edi/attr/pdediattr/model/models",
        "sap/ui/core/BusyIndicator"
    ],
    function (UIComponent, Device, models, BusyIndicator) {
        "use strict";

        return UIComponent.extend("com.at.pd.edi.attr.pdediattr.Component", {
            metadata: {
                manifest: "json"
            },

            /**
             * The component is initialized by UI5 automatically during the startup of the app and calls the init method once.
             * @public
             * @override
             */
            init: function () {
                // call the base component's init function
                UIComponent.prototype.init.apply(this, arguments);

                // set the device model
                this.setModel(models.createDeviceModel(), "device");

			    // Initialize router
			    this.getRouter().initialize();

                // Create parameters to track loading
                this._isSelfLoading = false;
                this._areMessagesLoading = false;
                this._arePartnersLoading = false;
            },

            // Allow children to report loading is complete
            loadComplete: function(oSource) {
                // Get information about reporter
                const source = oSource.getMetadata().getName();
                switch (source) {
                    case "com.at.pd.edi.attr.pdediattr.controller.MessageList":
                        this._areMessagesLoading = false;
                    case "com.at.pd.edi.attr.pdediattr.controller.PartnerDetail":
                        this._arePartnersLoading = false;
                    case "com.at.pd.edi.attr.pdediattr.controller.PartnerList":
                        this._arePartnersLoading = false;
                    case "com.at.pd.edi.attr.pdediattr.controller.Self":
                        this._isSelfLoading = false;
                    default:
                }

                // Remove indicator if all loads are complete
                if(!this._areMessagesLoading && !this._isSelfLoading && 
                    !this._arePartnersLoading) {
                    BusyIndicator.hide();
                }
            },

            // Allow children to report loading started
            loadStarted: function(oSource) {
                // Get information about reporter
                const source = oSource.getMetadata().getName();
                switch (source) {
                    case "com.at.pd.edi.attr.pdediattr.controller.MessageList":
                        this._areMessagesLoading = true;
                    case "com.at.pd.edi.attr.pdediattr.controller.PartnerList":
                        this._arePartnersLoading = true;
                    case "com.at.pd.edi.attr.pdediattr.controller.Self":
                        this._isSelfLoading = true;
                    default:
                }

                // Set busy indicator
                BusyIndicator.show(0);
            }
        });
    }
);