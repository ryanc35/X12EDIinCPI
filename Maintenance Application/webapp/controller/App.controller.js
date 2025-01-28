sap.ui.define(
    [
        "sap/ui/core/mvc/Controller"
    ],
    function(BaseController) {
      "use strict";
  
      return BaseController.extend("com.at.pd.edi.attr.pdediattr.controller.App", {

        onInit: function() {
            const controlModel = this.getOwnerComponent().getModel("control");
            this._userModel = this.getOwnerComponent().getModel("user");
            this._pUserDataLoaded ??= this._userModel.dataLoaded();
            this._pUserDataLoaded.then(function(oPromise){
              const scopes = this._userModel.getProperty("/scopes"),
                regex = /^.*\.Admin$/,
                isAdmin = scopes.filter(item => regex.test(item)).length > 0;
                controlModel.setProperty("/isAdmin", isAdmin);
                this._userModel = null;
            }.bind(this));
        },

        onItemSelect: function (oEvent) {
          const oItem = oEvent.getParameter("item");
          this.getOwnerComponent().getRouter().navTo(oItem.getKey());
        }
      });
    }
  );
  