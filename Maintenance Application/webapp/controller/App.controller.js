sap.ui.define(
    [
        "sap/ui/core/mvc/Controller"
    ],
    function(BaseController) {
      "use strict";
  
      return BaseController.extend("com.at.pd.edi.attr.pdediattr.controller.App", {

        onInit: function() {
        },

        onItemSelect: function (oEvent) {
          const oItem = oEvent.getParameter("item");
          this.getOwnerComponent().getRouter().navTo(oItem.getKey());
        }
      });
    }
  );
  