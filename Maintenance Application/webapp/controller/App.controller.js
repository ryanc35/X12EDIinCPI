sap.ui.define(
    [
        "sap/ui/core/mvc/Controller"
    ],
    function(BaseController) {
      "use strict";
  
      return BaseController.extend("com.at.pd.edi.attr.pdediattr.controller.App", {

        onInit: function() {
          this._controlModel = this.getOwnerComponent().getModel("control"),
          this._userModel = this.getOwnerComponent().getModel("user");
          this._controlModel.setProperty("/isAdmin", this._userModel.getProperty("/isAdmin"));
        },

        onItemSelect: function (oEvent) {
          const oItem = oEvent.getParameter("item");
          this.getOwnerComponent().getRouter().navTo(oItem.getKey());
        }
      });
    }
  );
  