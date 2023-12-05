sap.ui.define([
	"sap/ui/model/CompositeType",
  ], function(CompositeType) {
	"use strict";
  
	return CompositeType.extend("custom.model.type.StringyBoolean", {
	  constructor: function() {
		CompositeType.apply(this, arguments);
		this.bParseWithValues = true; // make 'parts' available in parseValue
	  },
  
	  /**
	   * Displaying data from the right model
	   */
	  formatValue: function(parts) {
		return parts[1].toString() === parts[0] ? true : false;
	  },
  
	  /**
	   * Assigning entered value to the right model
	   */
	  parseValue: function (enteredValue, stuff, parts) {
		switch (typeof(parts[0])) {
			case "string":
				return [ enteredValue.toString(), parts[1] ];
			case "boolean":
			default:
				return [ enteredValue, parts[1] ];
		}
	  },

	  validateValue: function () {} // Nothing to validate here
	});
  });