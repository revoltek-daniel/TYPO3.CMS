/*
 * This file is part of the TYPO3 CMS project.
 *
 * It is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License, either version 2
 * of the License, or any later version.
 *
 * For the full copyright and license information, please read the
 * LICENSE.txt file that was distributed with DocumentHeader source code.
 *
 * The TYPO3 project - inspiring people to share!
 */

import * as $ from 'jquery';
import Icons = require('./Icons');

class DocumentSaveActions {
  private static instance: DocumentSaveActions = null;
  private preSubmitCallbacks: Array<Function> = [];

  private constructor() {
    $((): void => {
      this.initializeSaveHandling();
    });
  }

  public static getInstance(): DocumentSaveActions {
    if (DocumentSaveActions.instance === null) {
      DocumentSaveActions.instance = new DocumentSaveActions();
    }

    return DocumentSaveActions.instance;
  }

  /**
   * Adds a callback being executed before submit
   *
   * @param {Function} callback
   */
  public addPreSubmitCallback(callback: Function): void {
    if (typeof callback !== 'function') {
      throw 'callback must be a function.';
    }

    this.preSubmitCallbacks.push(callback);
  }

  /**
   * Initializes the save handling
   */
  private initializeSaveHandling(): void {
    let preventExec = false;
    const elements = [
      'button[form]',
      'button[name^="_save"]',
      'a[data-name^="_save"]',
      'button[name="CMD"][value^="save"]',
      'a[data-name="CMD"][data-value^="save"]',
    ].join(',');

    $('.t3js-module-docheader').on('click', elements, (e: JQueryEventObject): boolean => {
      // prevent doubleclick double submission bug in chrome,
      // see https://forge.typo3.org/issues/77942
      if (!preventExec) {
        preventExec = true;
        const $me = $(e.currentTarget);
        const linkedForm = $me.attr('form') || $me.attr('data-form') || null;
        const $form = linkedForm ? $('#' + linkedForm) : $me.closest('form');
        const name = $me.data('name') || e.currentTarget.getAttribute('name');
        const value = $me.data('value') || e.currentTarget.getAttribute('value');
        const $elem = $('<input />').attr('type', 'hidden').attr('name', name).attr('value', value);

        // Run any preSubmit callbacks
        for (let i = 0; i < this.preSubmitCallbacks.length; ++i) {
          this.preSubmitCallbacks[i](e);

          if (e.isPropagationStopped()) {
            preventExec = false;
            return false;
          }
        }
        $form.append($elem);
        // Disable submit buttons
        $form.on('submit', (): boolean => {
          if ($form.find('.has-error').length > 0) {
            preventExec = false;
            return false;
          }

          let $affectedButton: JQuery;
          const $splitButton = $me.closest('.t3js-splitbutton');

          if ($splitButton.length > 0) {
            $splitButton.find('button').prop('disabled', true);
            $affectedButton = $splitButton.children().first();
          } else {
            $me.prop('disabled', true);
            $affectedButton = $me;
          }

          Icons.getIcon('spinner-circle-dark', Icons.sizes.small).done((markup: string): void => {
            $affectedButton.find('.t3js-icon').replaceWith(markup);
          });

          return true;
        });

        if ((e.currentTarget.tagName === 'A' || $me.attr('form')) && !e.isDefaultPrevented()) {
          $form.submit();
          e.preventDefault();
        }
      }

      return true;
    });
  }
}

export = DocumentSaveActions;
