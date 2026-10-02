/*
 * The default theme's script.
 *
 * Small on purpose. The site is server-rendered and architecture ADR-02 forbids a
 * frontend framework, so this file holds the two behaviours a static page cannot
 * express on its own, and nothing else.
 *
 * It is loaded with `defer`, so the document is parsed before it runs and the
 * elements it looks for are there.
 */

(function () {
  'use strict'

  var STORAGE_KEY = 'typeky:cookie-consent'

  /*
   * Storage access can throw rather than return null: a browser in private mode,
   * or one with site data blocked, raises on both read and write. A cookie notice
   * is not worth an uncaught error, so every access goes through these.
   */
  function readAccepted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'accepted'
    } catch (error) {
      return false
    }
  }

  function writeAccepted() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'accepted')
    } catch (error) {
      // Nothing to do: the notice is hidden for this visit either way.
    }
  }

  function setUpCookieConsent() {
    var notice = document.querySelector('[data-cookie-consent]')
    if (notice === null) return

    var accept = notice.querySelector('[data-cookie-consent-accept]')

    function dismiss() {
      notice.hidden = true
    }

    /*
     * The markup ships it hidden, so someone without JavaScript is not shown a
     * banner with no way to dismiss it. Showing it is therefore this script's job.
     */
    if (readAccepted()) {
      dismiss()
      return
    }

    notice.hidden = false

    if (accept !== null) {
      accept.addEventListener('click', function () {
        writeAccepted()
        dismiss()
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setUpCookieConsent)
  } else {
    setUpCookieConsent()
  }
})()
