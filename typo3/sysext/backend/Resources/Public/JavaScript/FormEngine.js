/*
 * This file is part of the TYPO3 CMS project.
 *
 * It is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License, either version 2
 * of the License, or any later version.
 *
 * For the full copyright and license information, please read the
 * LICENSE.txt file that was distributed with this source code.
 *
 * The TYPO3 project - inspiring people to share!
 */

/**
 * contains all JS functions related to TYPO3 TCEforms/FormEngine
 *
 * there are separate issues in this main object
 *   - functions, related to Element Browser ("Popup Window") and select fields
 *   - filling select fields (by wizard etc) from outside, formerly known via "setFormValueFromBrowseWin"
 *   - select fields: move selected items up and down via buttons, remove items etc
 */

// add legacy functions to be accessible in the global scope
var setFormValueOpenBrowser,
  setFormValueFromBrowseWin,
  setHiddenFromList,
  setFormValueManipulate,
  setFormValue_getFObj;

/**
 * Module: TYPO3/CMS/Backend/FormEngine
 */
define(['jquery',
  'TYPO3/CMS/Backend/FormEngineValidation',
  'TYPO3/CMS/Backend/DocumentSaveActions',
  'TYPO3/CMS/Backend/Modal',
  'TYPO3/CMS/Backend/Severity',
  'TYPO3/CMS/Backend/BackendException',
  'TYPO3/CMS/Backend/Event/InteractionRequestMap'
], function($, FormEngineValidation, DocumentSaveActions, Modal, Severity, BackendException, InteractionRequestMap) {

  /**
   * @param {InteractionRequest} interactionRequest
   * @param {boolean} response
   */
  function handleConsumeResponse(interactionRequest, response) {
    if (response) {
      FormEngine.interactionRequestMap.resolveFor(interactionRequest);
    } else {
      FormEngine.interactionRequestMap.rejectFor(interactionRequest);
    }
  }

  /**
   * @exports TYPO3/CMS/Backend/FormEngine
   */
  var FormEngine = {
    consumeTypes: ['typo3.setUrl', 'typo3.beforeSetUrl', 'typo3.refresh'],
    Validation: FormEngineValidation,
    interactionRequestMap: InteractionRequestMap,
    formName: TYPO3.settings.FormEngine.formName,
    openedPopupWindow: null,
    legacyFieldChangedCb: function() {
      !$.isFunction(TYPO3.settings.FormEngine.legacyFieldChangedCb) || TYPO3.settings.FormEngine.legacyFieldChangedCb();
    },
    browserUrl: ''
  };

  // functions to connect the db/file browser with this document and the formfields on it!

  /**
   * Opens a popup window with the element browser (browser.php)
   *
   * @param {String} mode can be "db" or "file"
   * @param {String} params additional params for the browser window
   */
  FormEngine.openPopupWindow = setFormValueOpenBrowser = function(mode, params) {
    return Modal.advanced({
      type: Modal.types.iframe,
      content: FormEngine.browserUrl + '&mode=' + mode + '&bparams=' + params,
      size: Modal.sizes.large
    });
  };

  /**
   * properly fills the select field from the popup window (element browser, link browser)
   * or from a multi-select (two selects side-by-side)
   * previously known as "setFormValueFromBrowseWin"
   *
   * @param {String} fieldName Formerly known as "fName" name of the field, like [tt_content][2387][header]
   * @param {(String|Number)} value The value to fill in (could be an integer)
   * @param {String} label The visible name in the selector
   * @param {String} title The title when hovering over it
   * @param {String} exclusiveValues If the select field has exclusive options that are not combine-able
   * @param {$} $optionEl The jQuery object of the selected <option> tag
   */
  FormEngine.setSelectOptionFromExternalSource = setFormValueFromBrowseWin = function(fieldName, value, label, title, exclusiveValues, $optionEl) {
    exclusiveValues = String(exclusiveValues);

    var $fieldEl,
      $originalFieldEl,
      isMultiple = false,
      isList = false;

    $originalFieldEl = $fieldEl = FormEngine.getFieldElement(fieldName);

    if ($originalFieldEl.length === 0 || value === '--div--') {
      return;
    }

    // Check if the form object has a "_list" element
    // The "_list" element exists for multiple selection select types
    var $listFieldEl = FormEngine.getFieldElement(fieldName, '_list', true);
    if ($listFieldEl.length > 0) {
      $fieldEl = $listFieldEl;
      isMultiple = ($fieldEl.prop('multiple') && $fieldEl.prop('size') != '1');
      isList = true;
    }

    // clear field before adding value, if configured so (maxitems==1)
    // @todo: clean this code
    if (typeof TBE_EDITOR.clearBeforeSettingFormValueFromBrowseWin[fieldName] !== 'undefined') {
      var clearSettings = TBE_EDITOR.clearBeforeSettingFormValueFromBrowseWin[fieldName];
      $fieldEl.empty();

      // Clear the upload field
      // @todo: Investigate whether we either need to fix this code or we can drop it.
      var filesContainer = document.getElementById(clearSettings.itemFormElID_file);
      if (filesContainer) {
        filesContainer.innerHTML = filesContainer.innerHTML;
      }
    }

    if (isMultiple || isList) {
      // If multiple values are not allowed, clear anything that is in the control already
      if (!isMultiple) {
        var $availableFieldEl = FormEngine.getFieldElement(fieldName, '_avail');
        $fieldEl.find('option').each(function() {
          $availableFieldEl
            .find('option[value="' + $.escapeSelector($(this).attr('value')) + '"]')
            .removeClass('hidden')
            .prop('disabled', false);
        });
        $fieldEl.empty();
      }

      // Clear elements if exclusive values are found
      if (exclusiveValues) {
        var reenableOptions = false;

        var m = new RegExp('(^|,)' + value + '($|,)');
        // the new value is exclusive => remove all existing values
        if (exclusiveValues.match(m)) {
          $fieldEl.empty();
          reenableOptions = true;
        } else if ($fieldEl.find('option').length == 1) {
          // there is an old value and it was exclusive => it has to be removed
          m = new RegExp("(^|,)" + $fieldEl.find('option').prop('value') + "($|,)");
          if (exclusiveValues.match(m)) {
            $fieldEl.empty();
            reenableOptions = true;
          }
        }

        if (reenableOptions && typeof $optionEl !== 'undefined') {
          $optionEl.closest('select').find('[disabled]').removeClass('hidden').prop('disabled', false)
        }
      }

      // Inserting the new element
      var addNewValue = true;

      // check if there is a "_mul" field (a field on the right) and if the field was already added
      var $multipleFieldEl = FormEngine.getFieldElement(fieldName, '_mul', true);
      if ($multipleFieldEl.length == 0 || $multipleFieldEl.val() == 0) {
        $fieldEl.find('option').each(function(k, optionEl) {
          if ($(optionEl).prop('value') == value) {
            addNewValue = false;
            return false;
          }
        });

        if (addNewValue && typeof $optionEl !== 'undefined') {
          $optionEl.addClass('hidden').prop('disabled', true);
        }
      }

      // element can be added
      if (addNewValue) {
        // finally add the option
        var $option = $('<option></option>');
        $option.attr({value: value, title: title}).text(label);
        $option.appendTo($fieldEl);

        // set the hidden field
        FormEngine.updateHiddenFieldValueFromSelect($fieldEl, $originalFieldEl);

        // execute the phpcode from $FormEngine->TBE_EDITOR_fieldChanged_func
        FormEngine.legacyFieldChangedCb();
      }

    } else {

      // The incoming value consists of the table name, an underscore and the uid
      // or just the uid
      // For a single selection field we need only the uid, so we extract it
      var pattern = /_(\\d+)$/
        , result = value.toString().match(pattern);

      if (result != null) {
        value = result[1];
      }

      // Change the selected value
      $fieldEl.val(value);
    }
    if (typeof FormEngine.Validation !== 'undefined' && typeof FormEngine.Validation.validate === 'function') {
      FormEngine.Validation.validate();
    }
  };

  /**
   * sets the value of the hidden field, from the select list, always executed after the select field was updated
   * previously known as global function setHiddenFromList()
   *
   * @param {HTMLElement} selectFieldEl the select field
   * @param {HTMLElement} originalFieldEl the hidden form field
   */
  FormEngine.updateHiddenFieldValueFromSelect = setHiddenFromList = function(selectFieldEl, originalFieldEl) {
    var selectedValues = [];
    $(selectFieldEl).find('option').each(function() {
      selectedValues.push($(this).prop('value'));
    });

    // make a comma separated list, if it is a multi-select
    // set the values to the final hidden field
    $(originalFieldEl).val(selectedValues.join(','));
  };

  /**
   * legacy function, can be removed once this function is not in use anymore
   *
   * @param {String} fName
   * @param {String} type
   * @param {Number} maxLength
   */
  setFormValueManipulate = function(fName, type, maxLength) {
    var $formEl = FormEngine.getFormElement(fName);
    if ($formEl.length > 0) {
      var formObj = $formEl.get(0);
      var localArray_V = [];
      var localArray_L = [];
      var localArray_S = [];
      var localArray_T = [];
      var fObjSel = formObj[fName + '_list'];
      var l = fObjSel.length;
      var c = 0;
      var a;

      if (type === 'RemoveFirstIfFull') {
        if (maxLength == 1) {
          for (a = 1; a < l; a++) {
            if (fObjSel.options[a].selected != 1) {
              localArray_V[c] = fObjSel.options[a].value;
              localArray_L[c] = fObjSel.options[a].text;
              localArray_S[c] = 0;
              localArray_T[c] = fObjSel.options[a].title;
              c++;
            }
          }
        } else {
          return;
        }
      }

      if ((type === "Remove" && fObjSel.size > 1) || type === "Top" || type === "Bottom") {
        if (type === "Top") {
          for (a = 0; a < l; a++) {
            if (fObjSel.options[a].selected == 1) {
              localArray_V[c] = fObjSel.options[a].value;
              localArray_L[c] = fObjSel.options[a].text;
              localArray_S[c] = 1;
              localArray_T[c] = fObjSel.options[a].title;
              c++;
            }
          }
        }
        for (a = 0; a < l; a++) {
          if (fObjSel.options[a].selected != 1) {
            localArray_V[c] = fObjSel.options[a].value;
            localArray_L[c] = fObjSel.options[a].text;
            localArray_S[c] = 0;
            localArray_T[c] = fObjSel.options[a].title;
            c++;
          }
        }
        if (type === "Bottom") {
          for (a = 0; a < l; a++) {
            if (fObjSel.options[a].selected == 1) {
              localArray_V[c] = fObjSel.options[a].value;
              localArray_L[c] = fObjSel.options[a].text;
              localArray_S[c] = 1;
              localArray_T[c] = fObjSel.options[a].title;
              c++;
            }
          }
        }
      }
      if (type === "Down") {
        var tC = 0;
        var tA = [];
        var aa = 0;

        for (a = 0; a < l; a++) {
          if (fObjSel.options[a].selected != 1) {
            // Add non-selected element:
            localArray_V[c] = fObjSel.options[a].value;
            localArray_L[c] = fObjSel.options[a].text;
            localArray_S[c] = 0;
            localArray_T[c] = fObjSel.options[a].title;
            c++;

            // Transfer any accumulated and reset:
            if (tA.length > 0) {
              for (aa = 0; aa < tA.length; aa++) {
                localArray_V[c] = fObjSel.options[tA[aa]].value;
                localArray_L[c] = fObjSel.options[tA[aa]].text;
                localArray_S[c] = 1;
                localArray_T[c] = fObjSel.options[tA[aa]].title;
                c++;
              }

              tC = 0;
              tA = [];
            }
          } else {
            tA[tC] = a;
            tC++;
          }
        }
        // Transfer any remaining:
        if (tA.length > 0) {
          for (aa = 0; aa < tA.length; aa++) {
            localArray_V[c] = fObjSel.options[tA[aa]].value;
            localArray_L[c] = fObjSel.options[tA[aa]].text;
            localArray_S[c] = 1;
            localArray_T[c] = fObjSel.options[tA[aa]].title;
            c++;
          }
        }
      }
      if (type === "Up") {
        var tC = 0;
        var tA = [];
        var aa = 0;
        c = l - 1;

        for (a = l - 1; a >= 0; a--) {
          if (fObjSel.options[a].selected != 1) {

            // Add non-selected element:
            localArray_V[c] = fObjSel.options[a].value;
            localArray_L[c] = fObjSel.options[a].text;
            localArray_S[c] = 0;
            localArray_T[c] = fObjSel.options[a].title;
            c--;

            // Transfer any accumulated and reset:
            if (tA.length > 0) {
              for (aa = 0; aa < tA.length; aa++) {
                localArray_V[c] = fObjSel.options[tA[aa]].value;
                localArray_L[c] = fObjSel.options[tA[aa]].text;
                localArray_S[c] = 1;
                localArray_T[c] = fObjSel.options[tA[aa]].title;
                c--;
              }

              tC = 0;
              tA = [];
            }
          } else {
            tA[tC] = a;
            tC++;
          }
        }
        // Transfer any remaining:
        if (tA.length > 0) {
          for (aa = 0; aa < tA.length; aa++) {
            localArray_V[c] = fObjSel.options[tA[aa]].value;
            localArray_L[c] = fObjSel.options[tA[aa]].text;
            localArray_S[c] = 1;
            localArray_T[c] = fObjSel.options[tA[aa]].title;
            c--;
          }
        }
        c = l;	// Restore length value in "c"
      }

      // Transfer items in temporary storage to list object:
      fObjSel.length = c;
      for (a = 0; a < c; a++) {
        fObjSel.options[a].value = localArray_V[a];
        fObjSel.options[a].text = localArray_L[a];
        fObjSel.options[a].selected = localArray_S[a];
        fObjSel.options[a].title = localArray_T[a];
      }
      FormEngine.updateHiddenFieldValueFromSelect(fObjSel, formObj[fName]);

      FormEngine.legacyFieldChangedCb();
    }
  };


  /**
   * Legacy function
   * returns the DOM object for the given form name of the current form,
   * but only if the given field name is valid, legacy function, use "getFormElement" instead
   *
   * @param {String} fieldName the name of the field name
   * @returns {*|HTMLElement}
   */
  setFormValue_getFObj = function(fieldName) {
    var $formEl = FormEngine.getFormElement(fieldName);
    if ($formEl.length > 0) {
      // return the DOM element of the form object
      return $formEl.get(0);
    }
    return null;
  };

  /**
   * returns a jQuery object for the given form name of the current form,
   * if the parameter "fieldName" is given, then the form element is only returned if the field name is available
   * the latter behaviour mirrors the one of the function "setFormValue_getFObj"
   *
   * @param {String} fieldName the field name to check for, optional
   * @returns {*|HTMLElement}
   */
  FormEngine.getFormElement = function(fieldName) {
    var $formEl = $('form[name="' + FormEngine.formName + '"]:first');
    if (fieldName) {
      var $fieldEl = FormEngine.getFieldElement(fieldName)
        , $listFieldEl = FormEngine.getFieldElement(fieldName, '_list');

      // Take the form object if it is either of type select-one or of type-multiple and it has a "_list" element
      if ($fieldEl.length > 0 &&
        (
          ($fieldEl.prop('type') === 'select-one') ||
          ($listFieldEl.length > 0 && $listFieldEl.prop('type').match(/select-(one|multiple)/))
        )
      ) {
        return $formEl;
      } else {
        console.error('Form fields missing: form: ' + FormEngine.formName + ', field name: ' + fieldName);
        alert('Form field is invalid');
      }
    } else {
      return $formEl;
    }
  };


  /**
   * Returns a jQuery object of the field DOM element of the current form, can also be used to
   * request an alternative field like "_hr", "_list" or "_mul"
   *
   * @param {String} fieldName the name of the field (<input name="fieldName">)
   * @param {String} appendix optional
   * @param {Boolean} noFallback if set, then the appendix value is returned no matter if it exists or not
   * @returns {*|HTMLElement}
   */
  FormEngine.getFieldElement = function(fieldName, appendix, noFallback) {
    var $formEl = $('form[name="' + FormEngine.formName + '"]:first');

    // if an appendix is set, return the field with the appendix (like _mul or _list)
    if (appendix) {
      var $fieldEl;
      switch (appendix) {
        case '_list':
          $fieldEl = $(':input.tceforms-multiselect[data-formengine-input-name="' + fieldName + '"]', $formEl);
          break;
        case '_avail':
          $fieldEl = $(':input[data-relatedfieldname="' + fieldName + '"]', $formEl);
          break;
        case '_mul':
        case '_hr':
          $fieldEl = $(':input[type=hidden][data-formengine-input-name="' + fieldName + '"]', $formEl);
          break;
      }
      if (($fieldEl && $fieldEl.length > 0) || noFallback === true) {
        return $fieldEl;
      }
    }

    return $(':input[name="' + fieldName + '"]', $formEl);
  };

  /**
   * Initialize events for all form engine relevant tasks.
   * This function only needs to be called once on page load,
   * as it using deferrer methods only
   */
  FormEngine.initializeEvents = function() {
    if (top.TYPO3 && typeof top.TYPO3.Backend !== 'undefined') {
      top.TYPO3.Backend.consumerScope.attach(FormEngine);
      $(window).on('unload', function() {
        top.TYPO3.Backend.consumerScope.detach(FormEngine);
      });
    }
    $(document).on('click', '.t3js-editform-close', function(e) {
        e.preventDefault();
        FormEngine.preventExitIfNotSaved(
            FormEngine.preventExitIfNotSavedCallback
        );
    }).on('click', '.t3js-editform-view', function(e) {
      e.preventDefault();
      FormEngine.previewAction(e, FormEngine.previewActionCallback);
    }).on('click', '.t3js-editform-new', function(e) {
      e.preventDefault();
      FormEngine.newAction(e, FormEngine.newActionCallback);
    }).on('click', '.t3js-editform-duplicate', function(e) {
      e.preventDefault();
      FormEngine.duplicateAction(e, FormEngine.duplicateActionCallback);
    }).on('click', '.t3js-editform-delete-record', function(e) {
      e.preventDefault();
      FormEngine.deleteAction(e, FormEngine.deleteActionCallback);
    }).on('click', '.t3js-editform-submitButton', function(event) {
      // remember the clicked submit button. we need to know that in TBE_EDITOR.submitForm();
      var $me = $(this),
        name = $me.data('name') || this.name,
        $elem = $('<input />').attr('type', 'hidden').attr('name', name).attr('value', '1');

      $me.parents('form').append($elem);
    }).on('change', '.t3-form-field-eval-null-checkbox input[type="checkbox"]', function(e) {
      // Null checkboxes without placeholder click event handler
      $(this).closest('.t3js-formengine-field-item').toggleClass('disabled');
    }).on('change', '.t3js-form-field-eval-null-placeholder-checkbox input[type="checkbox"]', function(e) {
      FormEngine.toggleCheckboxField($(this));
    }).on('change', function(event) {
      $('.module-docheader-bar .btn').removeClass('disabled').prop('disabled', false);
    }).on('click', '.t3js-element-browser', function(e) {
      e.preventDefault();
      e.stopPropagation();

      const $me = $(e.currentTarget);
      const mode = $me.data('mode');
      const params = $me.data('params');

      FormEngine.openPopupWindow(mode, params);
    });
  };

  /**
   * @param {InteractionRequest} interactionRequest
   * @return {jQuery.Deferred}
   */
  FormEngine.consume = function(interactionRequest) {
    if (!interactionRequest) {
      throw new BackendException('No interaction request given', 1496589980);
    }
    if (interactionRequest.concernsTypes(FormEngine.consumeTypes)) {
      var outerMostRequest = interactionRequest.outerMostRequest;
      var deferred = $.Deferred();

      FormEngine.interactionRequestMap.attachFor(
        outerMostRequest,
        deferred
      );
      // resolve or reject deferreds with previous user choice
      if (outerMostRequest.isProcessed()) {
        handleConsumeResponse(
          outerMostRequest,
          outerMostRequest.getProcessedData().response
        );
        // show confirmation dialog
      } else if (FormEngine.hasChange()) {
        FormEngine.preventExitIfNotSaved(function(response) {
          outerMostRequest.setProcessedData(
            {response: response}
          );
          handleConsumeResponse(outerMostRequest, response);
        });
        // resolve directly
      } else {
        FormEngine.interactionRequestMap.resolveFor(outerMostRequest);
      }

      return deferred;
    }
  };

  /**
   * Initializes the remaining character views based on the fields' maxlength attribute
   */
  FormEngine.initializeRemainingCharacterViews = function() {
    // all fields with a "maxlength" attribute
    var $maxlengthElements = $('[maxlength]').not('.t3js-datetimepicker').not('.t3js-charcounter-initialized');
    $maxlengthElements.on('focus', function(e) {
      var $field = $(this),
        $parent = $field.parents('.t3js-formengine-field-item:first'),
        maxlengthProperties = FormEngine.getCharacterCounterProperties($field);

      // append the counter only at focus to avoid cluttering the DOM
      $parent.append($('<div />', {'class': 't3js-charcounter'}).append(
        $('<span />', {'class': maxlengthProperties.labelClass}).text(TYPO3.lang['FormEngine.remainingCharacters'].replace('{0}', maxlengthProperties.remainingCharacters))
      ));
    }).on('blur', function() {
      var $field = $(this),
        $parent = $field.parents('.t3js-formengine-field-item:first');
      $parent.find('.t3js-charcounter').remove();
    }).on('keyup', function() {
      var $field = $(this),
        $parent = $field.parents('.t3js-formengine-field-item:first'),
        maxlengthProperties = FormEngine.getCharacterCounterProperties($field);

      // change class and value
      $parent.find('.t3js-charcounter span').removeClass().addClass(maxlengthProperties.labelClass).text(TYPO3.lang['FormEngine.remainingCharacters'].replace('{0}', maxlengthProperties.remainingCharacters))
    });
    $maxlengthElements.addClass('t3js-charcounter-initialized');
    $(':password').on('focus', function() {
      $(this).attr({'type':'text', 'data-active-password':'true'}).select();
    }).on('blur', function() {
      $(this).attr('type', 'password').removeAttr('data-active-password');
    });
  };

  /**
   * Get the properties required for proper rendering of the character counter
   *
   * @param {Object} $field
   * @returns {{remainingCharacters: number, labelClass: string}}
   */
  FormEngine.getCharacterCounterProperties = function($field) {
    var fieldText = $field.val(),
      maxlength = $field.attr('maxlength'),
      currentFieldLength = fieldText.length,
      numberOfLineBreaks = (fieldText.match(/\n/g) || []).length, // count line breaks
      remainingCharacters = maxlength - currentFieldLength - numberOfLineBreaks,
      threshold = 15, // hard limit of remaining characters when the label class changes
      labelClass = '';

    if (remainingCharacters < threshold) {
      labelClass = 'label-danger';
    } else if (remainingCharacters < threshold * 2) {
      labelClass = 'label-warning';
    } else {
      labelClass = 'label-info';
    }

    return {
      remainingCharacters: remainingCharacters,
      labelClass: 'label ' + labelClass
    };
  };

  /**
   * Initialize input / text field "null" checkbox CSS overlay if no placeholder is set.
   */
  FormEngine.initializeNullNoPlaceholderCheckboxes = function() {
    $('.t3-form-field-eval-null-checkbox').each(function() {
      // Add disabled class to "t3js-formengine-field-item" if the null checkbox is NOT set,
      // This activates a CSS overlay "disabling" the input field and everything around.
      var $checkbox = $(this).find('input[type="checkbox"]');
      var $fieldItem = $(this).closest('.t3js-formengine-field-item');
      if (!$checkbox.attr('checked')) {
        $fieldItem.addClass('disabled');
      }
    });
  };

  /**
   * Initialize input / text field "null" checkbox placeholder / real field if placeholder is set.
   */
  FormEngine.initializeNullWithPlaceholderCheckboxes = function() {
    $('.t3js-form-field-eval-null-placeholder-checkbox').each(function() {
      FormEngine.toggleCheckboxField($(this).find('input[type="checkbox"]'));
    });
  };

  /**
   * Set initial state of both div's (one containing actual field, other containing placeholder field)
   * depending on whether checkbox is checked or not
   * @param $checkbox
   */
  FormEngine.toggleCheckboxField = function($checkbox) {
    var $item = $checkbox.closest('.t3js-formengine-field-item');
    if ($checkbox.prop('checked')) {
      $item.find('.t3js-formengine-placeholder-placeholder').hide();
      $item.find('.t3js-formengine-placeholder-formfield').show();
    } else {
      $item.find('.t3js-formengine-placeholder-placeholder').show();
      $item.find('.t3js-formengine-placeholder-formfield').hide();
    }
  };

  /**
   * This is the main function that is called on page load, but also after elements are asynchronously
   * called e.g. after inline elements are loaded, or a new flexform section is added.
   * Use this function in your extension like this "TYPO3.FormEngine.initialize()"
   * if you add new fields dynamically.
   */
  FormEngine.reinitialize = function() {
    // Apply "close" button to all input / datetime fields
    if ($('.t3js-clearable').length) {
      require(['TYPO3/CMS/Backend/jquery.clearable'], function() {
        $('.t3js-clearable').clearable();
      });
    }

    FormEngine.initializeNullNoPlaceholderCheckboxes();
    FormEngine.initializeNullWithPlaceholderCheckboxes();
    FormEngine.initializeLocalizationStateSelector();
    FormEngine.initializeRemainingCharacterViews();
  };

  /**
   * Disable the input field on load if localization state selector is set to "parent" or "source"
   */
  FormEngine.initializeLocalizationStateSelector = function() {
    $('.t3js-l10n-state-container').each(function() {
      var $input = $(this).closest('.t3js-formengine-field-item').find('[data-formengine-input-name]');
      var currentState = $(this).find('input[type="radio"]:checked').val();
      if (currentState === 'parent' || currentState === 'source') {
        $input.attr('disabled', 'disabled');
      }
    });
  };

  /**
   * @return {boolean}
   */
  FormEngine.hasChange = function() {
    var formElementChanges = $('form[name="' + FormEngine.formName + '"] .has-change').length > 0,
        inlineRecordChanges = $('[name^="data["].has-change').length > 0;
    return formElementChanges || inlineRecordChanges;
  };

  /**
   * @param {boolean} response
   */
  FormEngine.preventExitIfNotSavedCallback = function(response) {
    FormEngine.closeDocument();
  };

  /**
   * Show modal to confirm following a clicked link to confirm leaving the document without saving
   *
   * @param {String} href
   * @returns {Boolean}
   */
  FormEngine.preventFollowLinkIfNotSaved = function(href) {
    FormEngine.preventExitIfNotSaved(
      function () {
        window.location.href = href;
      }
    );
    return false;
  };

  /**
   * Show modal to confirm closing the document without saving.
   *
   * @param {Function} callback
   */
  FormEngine.preventExitIfNotSaved = function(callback) {
    callback = callback || FormEngine.preventExitIfNotSavedCallback;

    if (FormEngine.hasChange()) {
      var title = TYPO3.lang['label.confirm.close_without_save.title'] || 'Do you want to close without saving?';
      var content = TYPO3.lang['label.confirm.close_without_save.content'] || 'You currently have unsaved changes. Are you sure you want to discard these changes?';
      var $elem = $('<input />').attr('type', 'hidden').attr('name', '_saveandclosedok').attr('value', '1');
      var buttons = [
        {
          text: TYPO3.lang['buttons.confirm.close_without_save.no'] || 'No, I will continue editing',
          btnClass: 'btn-default',
          name: 'no'
        },
        {
          text: TYPO3.lang['buttons.confirm.close_without_save.yes'] || 'Yes, discard my changes',
          btnClass: 'btn-default',
          name: 'yes'
        }
      ];
      if ($('.has-error').length === 0) {
        buttons.push({
          text: TYPO3.lang['buttons.confirm.save_and_close'] || 'Save and close',
          btnClass: 'btn-warning',
          name: 'save',
          active: true
        });
      }

      var $modal = Modal.confirm(title, content, Severity.warning, buttons);
      $modal.on('button.clicked', function(e) {
        if (e.target.name === 'no') {
          Modal.dismiss();
        } else if (e.target.name === 'yes') {
          Modal.dismiss();
          callback.call(null, true);
        } else if (e.target.name === 'save') {
          $('form[name=' + FormEngine.formName + ']').append($elem);
          $('input[name=doSave]').val(1);
          Modal.dismiss();
          document.editform.submit();
        }
      });
    } else {
      callback.call(null, true);
    }
  };

  /**
   * Show modal to confirm closing the document without saving
   */
  FormEngine.preventSaveIfHasErrors = function() {
    if ($('.has-error').length > 0) {
      var title = TYPO3.lang['label.alert.save_with_error.title'] || 'You have errors in your form!';
      var content = TYPO3.lang['label.alert.save_with_error.content'] || 'Please check the form, there is at least one error in your form.';
      var $modal = Modal.confirm(title, content, Severity.error, [
        {
          text: TYPO3.lang['buttons.alert.save_with_error.ok'] || 'OK',
          btnClass: 'btn-danger',
          name: 'ok'
        }
      ]);
      $modal.on('button.clicked', function(e) {
        if (e.target.name === 'ok') {
          Modal.dismiss();
        }
      });
      return false;
    }
    return true;
  };

  /**
   * Preview action
   *
   * When there are changes:
   * Will take action based on local storage preset
   * If preset is not available, a modal will open
   *
   * @param {Event} event
   * @param {Function} callback
   */
  FormEngine.previewAction = function(event, callback) {
    callback = callback || FormEngine.previewActionCallback;

    var previewUrl = event.target.href;
    var isNew = event.target.dataset.hasOwnProperty('isNew');
    var $actionElement = $('<input />').attr('type', 'hidden').attr('name', '_savedokview').attr('value', '1');
    if (FormEngine.hasChange()) {
      FormEngine.showPreviewModal(previewUrl, isNew, $actionElement, callback);
    } else {
      $('form[name=' + FormEngine.formName + ']').append($actionElement);
      window.open('', 'newTYPO3frontendWindow');
      document.editform.submit();
    }
  };

  /**
   * The callback for the preview action
   *
   * @param {string} modalButtonName
   * @param {string} previewUrl
   * @param {element} $actionElement
   */
  FormEngine.previewActionCallback = function(modalButtonName, previewUrl, $actionElement) {
    Modal.dismiss();
    switch(modalButtonName) {
      case 'discard':
        var previewWin = window.open(previewUrl, 'newTYPO3frontendWindow');
        previewWin.focus();
        if (previewWin.location.href === previewUrl) {
          previewWin.location.reload();
        }
        break;
      case 'save':
        $('form[name=' + FormEngine.formName + ']').append($actionElement);
        $('input[name=doSave]').val(1);
        window.open('', 'newTYPO3frontendWindow');
        document.editform.submit();
        break;
    }
  };

  /**
   * Show the preview modal
   *
   * @param {string} previewUrl
   * @param {bool} isNew
   * @param {element} $actionElement
   * @param {Function} callback
   */
  FormEngine.showPreviewModal = function(previewUrl, isNew, $actionElement, callback) {
    var title = TYPO3.lang['label.confirm.view_record_changed.title'] || 'Do you want to save before viewing?';
    var modalCancelButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.view_record_changed.cancel'] || 'Cancel',
      btnClass: 'btn-default',
      name: 'cancel'
    };
    var modaldismissViewButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.view_record_changed.no-save'] || 'View without changes',
      btnClass: 'btn-info',
      name: 'discard'
    };
    var modalsaveViewButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.view_record_changed.save'] || 'Save changes and view',
      btnClass: 'btn-info',
      name: 'save',
      active: true
    };
    var modalButtons = [];
    var content = '';
    if (isNew) {
      modalButtons = [
        modalCancelButtonConfiguration,
        modalsaveViewButtonConfiguration
      ];
      content = (
        TYPO3.lang['label.confirm.view_record_changed.content.is-new-page']
        || 'You need to save your changes before viewing the page. Do you want to save and view them now?'
      );
    } else {
      modalButtons = [
        modalCancelButtonConfiguration,
        modaldismissViewButtonConfiguration,
        modalsaveViewButtonConfiguration
      ];
      content = (
        TYPO3.lang['label.confirm.view_record_changed.content']
        || 'You currently have unsaved changes. You can either discard these changes or save and view them.'
      )
    }
    var $modal = Modal.confirm(title, content, Severity.info, modalButtons);
    $modal.on('button.clicked', function (event) {
      callback(event.target.name, previewUrl, $actionElement, $modal);
    });
  };

  /**
   * New action
   *
   * When there are changes:
   * Will take action based on local storage preset
   * If preset is not available, a modal will open
   *
   * @param {Event} event
   * @param {Function} callback
   */
  FormEngine.newAction = function(event, callback) {
    callback = callback || FormEngine.newActionCallback;

    var $actionElement = $('<input />').attr('type', 'hidden').attr('name', '_savedoknew').attr('value', '1');
    var isNew = event.target.dataset.hasOwnProperty('isNew');
    if (FormEngine.hasChange()) {
      FormEngine.showNewModal(isNew, $actionElement, callback);
    } else {
      $('form[name=' + FormEngine.formName + ']').append($actionElement);
      document.editform.submit();
    }
  };

  /**
   * The callback for the preview action
   *
   * @param {string} modalButtonName
   * @param {element} $actionElement
   */
  FormEngine.newActionCallback = function(modalButtonName, $actionElement) {
    var $form = $('form[name=' + FormEngine.formName + ']');
    Modal.dismiss();
    switch(modalButtonName) {
      case 'no':
        $form.append($actionElement);
        document.editform.submit();
        break;
      case 'yes':
        $form.append($actionElement);
        $('input[name=doSave]').val(1);
        document.editform.submit();
        break;
    }
  };

  /**
   * Show the new modal
   *
   * @param {element} $actionElement
   * @param {Function} callback
   * @param {bool} isNew
   */
  FormEngine.showNewModal = function(isNew, $actionElement, callback) {
    var title = TYPO3.lang['label.confirm.new_record_changed.title'] || 'Do you want to save before adding?';
    var content = (
      TYPO3.lang['label.confirm.new_record_changed.content']
      || 'You need to save your changes before creating a new record. Do you want to save and create now?'
    );
    var modalButtons = [];
    var modalCancelButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.new_record_changed.cancel'] || 'Cancel',
      btnClass: 'btn-default',
      name: 'cancel'
    };
    var modalNoButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.new_record_changed.no'] || 'No, just add',
      btnClass: 'btn-default',
      name: 'no'
    };
    var modalYesButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.new_record_changed.yes'] || 'Yes, save and create now',
      btnClass: 'btn-info',
      name: 'yes',
      active: true
    };
    if (isNew) {
      modalButtons = [
        modalCancelButtonConfiguration,
        modalYesButtonConfiguration
      ];
    } else {
      modalButtons = [
        modalCancelButtonConfiguration,
        modalNoButtonConfiguration,
        modalYesButtonConfiguration
      ];
    }
    var $modal = Modal.confirm(title, content, Severity.info, modalButtons);
    $modal.on('button.clicked', function (event) {
        callback(event.target.name, $actionElement);
    });
  };

  /**
   * Duplicate action
   *
   * When there are changes:
   * Will take action based on local storage preset
   * If preset is not available, a modal will open
   *
   * @param {Event} event
   * @param {Function} callback
   */
  FormEngine.duplicateAction = function(event, callback) {
    callback = callback || FormEngine.duplicateActionCallback;

    var $actionElement = $('<input />').attr('type', 'hidden').attr('name', '_duplicatedoc').attr('value', '1');
    var isNew = event.target.dataset.hasOwnProperty('isNew');
    if (FormEngine.hasChange()) {
        FormEngine.showDuplicateModal(isNew, $actionElement, callback);
    } else {
      $('form[name=' + FormEngine.formName + ']').append($actionElement);
      document.editform.submit();
    }
  };

  /**
   * The callback for the duplicate action
   *
   * @param {string} modalButtonName
   * @param {element} $actionElement
   */
  FormEngine.duplicateActionCallback = function(modalButtonName, $actionElement) {
    var $form = $('form[name=' + FormEngine.formName + ']');
    Modal.dismiss();
    switch(modalButtonName) {
      case 'no':
        $form.append($actionElement);
        document.editform.submit();
        break;
      case 'yes':
        $form.append($actionElement);
        $('input[name=doSave]').val(1);
        document.editform.submit();
        break;
    }
  };

  /**
   * Show the duplicate modal
   *
   * @param {bool} isNew
   * @param {element} $actionElement
   * @param {Function} callback
   */
  FormEngine.showDuplicateModal = function(isNew, $actionElement, callback) {
    var title = TYPO3.lang['label.confirm.duplicate_record_changed.title'] || 'Do you want to save before duplicating this record?';
    var content = (
      TYPO3.lang['label.confirm.duplicate_record_changed.content']
      || 'You currently have unsaved changes. Do you want to save your changes before duplicating this record?'
    );
    var modalButtons = [];
    var modalCancelButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.duplicate_record_changed.cancel'] || 'Cancel',
      btnClass: 'btn-default',
      name: 'cancel'
    };
    var modalDismissDuplicateButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.duplicate_record_changed.no'] || 'No, just duplicate the original',
      btnClass: 'btn-default',
      name: 'no'
    };
    var modalSaveDuplicateButtonConfiguration = {
      text: TYPO3.lang['buttons.confirm.duplicate_record_changed.yes'] || 'Yes, save and duplicate this record',
      btnClass: 'btn-info',
      name: 'yes',
      active: true
    };
    if (isNew) {
      modalButtons = [
        modalCancelButtonConfiguration,
        modalSaveDuplicateButtonConfiguration
      ];
    } else {
      modalButtons = [
        modalCancelButtonConfiguration,
        modalDismissDuplicateButtonConfiguration,
        modalSaveDuplicateButtonConfiguration
      ];
    }
    var $modal = Modal.confirm(title, content, Severity.info, modalButtons);
    $modal.on('button.clicked', function (event) {
      callback(event.target.name, $actionElement);
    });
  };

  /**
   * Delete action
   *
   * When there are changes:
   * Will take action based on local storage preset
   * If preset is not available, a modal will open
   *
   * @param {Event} event
   * @param {Function} callback
   */
  FormEngine.deleteAction = function(event, callback) {
    callback = callback || FormEngine.deleteActionCallback;

    var $anchorElement = $(event.target);

    FormEngine.showDeleteModal($anchorElement, callback);
  };

  /**
   * The callback for the delete action
   *
   * @param {string} modalButtonName
   * @param {element} $anchorElement
   */
  FormEngine.deleteActionCallback = function(modalButtonName, $anchorElement) {
    Modal.dismiss();
    switch(modalButtonName) {
      case 'yes':
        deleteRecord($anchorElement.data('table'), $anchorElement.data('uid'), $anchorElement.data('return-url'));
        break;
    }
  };

  /**
   * Show the delete modal
   *
   * @param {element} $anchorElement
   * @param {Function} callback
   */
  FormEngine.showDeleteModal = function($anchorElement, callback) {
      var title = TYPO3.lang['label.confirm.delete_record.title'] || 'Delete this record?';
      var content = TYPO3.lang['label.confirm.delete_record.content'] || 'Are you sure you want to delete this record?';

      if ($anchorElement.data('reference-count-message')) {
        content += ' ' + $anchorElement.data('reference-count-message');
      }

      if ($anchorElement.data('translation-count-message')) {
        content += ' ' + $anchorElement.data('translation-count-message');
      }

      var $modal = Modal.confirm(title, content, Severity.warning, [
        {
          text: TYPO3.lang['buttons.confirm.delete_record.no'] || 'Cancel',
          btnClass: 'btn-default',
          name: 'no'
        },
        {
          text: TYPO3.lang['buttons.confirm.delete_record.yes'] || 'Yes, delete this record',
          btnClass: 'btn-warning',
          name: 'yes',
          active: true
        }
      ]);
      $modal.on('button.clicked', function (event) {
        callback(event.target.name, $anchorElement);
      });
  };

  /**
   * Close current open document
   */
  FormEngine.closeDocument = function() {
    document.editform.closeDoc.value = 1;
    document.editform.submit();
  };

  /**
   * Main init function called from outside
   *
   * Sets some options and registers the DOMready handler to initialize further things
   *
   * @param {String} browserUrl
   * @param {Number} mode
   */
  FormEngine.initialize = function(browserUrl, mode) {
    // This is required to register the click handler
    DocumentSaveActions.getInstance();

    FormEngine.browserUrl = browserUrl;
    FormEngine.Validation.setUsMode(mode);

    $(function() {
      FormEngine.initializeEvents();
      FormEngine.Validation.initialize();
      FormEngine.reinitialize();
      $('#t3js-ui-block').remove();
    });
  };

  // load required modules to hook in the post initialize function
  if (undefined !== TYPO3.settings.RequireJS && undefined !== TYPO3.settings.RequireJS.PostInitializationModules['TYPO3/CMS/Backend/FormEngine']) {
    $.each(TYPO3.settings.RequireJS.PostInitializationModules['TYPO3/CMS/Backend/FormEngine'], function(pos, moduleName) {
      require([moduleName]);
    });
  }

  // make the form engine object publicly visible for other objects in the TYPO3 namespace
  TYPO3.FormEngine = FormEngine;

  // return the object in the global space
  return FormEngine;
});
