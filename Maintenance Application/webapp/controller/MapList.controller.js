sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/ui/model/Filter", 
    "sap/ui/model/FilterOperator"
],
    /**
     * @param {typeof sap.ui.core.mvc.Controller} Controller
     */
    function (Controller, MessageBox, Filter, FilterOperator) {
        "use strict";

        return Controller.extend("com.at.pd.edi.attr.pdediattr.controller.MapList", {
            onInit: function () {
                // Initialize core parameters
                this._controlModel = this.getOwnerComponent().getModel("control"),
                this._i18nBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle(),
                this._oView = this.getView();

                // Get model and load properties
                const oDataModel = this._getModel();
                this._metadataLoaded ??= oDataModel.metadataLoaded();
                this._metadataLoaded.then(function(oPromise) {
                    // Read maps during initialization
                    this._readMaps();
                }.bind(this));
            },

            // Add map
            onAdd: function() {
                // Navigate to detail page
            },

            // Delete message
            onDelete: function(oEvent) {
                // Get identifying context for removal
            },

            // Item selection - get key for navigation to detail display
            onSelect: function(oEvent) {
                // Get map key information for data retrieval
            },

            // Get model for view
            _getModel: function() {
                return this.getOwnerComponent().getModel("messages");
            },

            // Read map data
            _readMaps: function() {
                // Create message model and get list of maps
                const oDataModel = this._getModel();
                oDataModel.read("/BinaryParameters", {
                    filters: [new Filter({
                        path: "Id",
                        operator: FilterOperator.Contains,
                        value1: "'_to_'"
                    }), new Filter({
                        path: "ContentType",
                        operator: FilterOperator.EQ,
                        value1: "xsl"
                    })],
                    success: function(oData, oError) {
                        // Parse map information
                        var maps = [];
                        for(const data of oData.results) {
                            var map = {};
                            map.id = data.Id;
                            const parts = data.Id.split("_to_");
                            var x12Parts;
                            if(parts[0].startsWith("ASC-X12_")) {
                                map.direction = "inbound",
                                map.idoc = parts[1],
                                map.message = parts[0];
                                x12Parts = parts[0].replaceAll("ASC-X12_", "").split("_");
                            } else {
                                map.direction = "outbound",
                                map.idoc = parts[0],
                                map.message = parts[1];
                                x12Parts = parts[1].replaceAll("ASC-X12_", "").split("_");
                            }
                            map.x12Type = x12Parts[0],
                            map.x12Version = x12Parts[1];
                            maps.push(map);
                        }

                        // Store into JSON model for display
                        this._controlModel.setProperty("/maps/list", maps);
                    }.bind(this)
                })
            }
        });
    });