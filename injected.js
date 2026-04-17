// ============================================================
//  Privacy Auditor – Main-world injected hooks
//  Loaded via manifest "world": "MAIN" → bypasses page CSP
// ============================================================

(function () {
  'use strict';

  function notify(api) {
    window.postMessage({ __PA__: true, type: 'fp', api }, '*');
  }

  // ── Canvas fingerprinting ────────────────────────────────
  try {
    const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...a) {
      notify('canvas_toDataURL');
      return _toDataURL.apply(this, a);
    };

    const _toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...a) {
      notify('canvas_toBlob');
      return _toBlob.apply(this, a);
    };

    const _getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const ctx = _getContext.apply(this, [type, ...a]);
      if (ctx && type === '2d') {
        const _getImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function (...b) {
          notify('canvas_getImageData');
          return _getImageData(...b);
        };
      }
      if (type === 'webgl' || type === 'webgl2') {
        notify('webgl_context');
        if (ctx) {
          const _getParam = ctx.getParameter.bind(ctx);
          ctx.getParameter = function (...b) {
            notify('webgl_getParameter');
            return _getParam(...b);
          };
        }
      }
      return ctx;
    };
  } catch (_) {}

  // ── AudioContext fingerprinting ──────────────────────────
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const _createOsc = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function (...a) {
        notify('audio_oscillator');
        return _createOsc.apply(this, a);
      };
      const _createAnalyser = AC.prototype.createAnalyser;
      AC.prototype.createAnalyser = function (...a) {
        notify('audio_analyser');
        return _createAnalyser.apply(this, a);
      };
    }
  } catch (_) {}

  // ── Font fingerprinting ──────────────────────────────────
  try {
    if (document.fonts && document.fonts.check) {
      const _check = document.fonts.check.bind(document.fonts);
      document.fonts.check = function (...a) {
        notify('font_check');
        return _check(...a);
      };
    }
  } catch (_) {}

  // ── Battery API ──────────────────────────────────────────
  try {
    if (navigator.getBattery) {
      const _gb = navigator.getBattery.bind(navigator);
      navigator.getBattery = function (...a) {
        notify('battery_api');
        return _gb(...a);
      };
    }
  } catch (_) {}

  // ── Navigator property fingerprinting ───────────────────
  // Fire only after FP_THRESHOLD distinct properties are read
  const fpPropsRead = new Set();
  const FP_THRESHOLD = 4;
  const FP_PROPS = [
    'hardwareConcurrency', 'deviceMemory', 'platform',
    'languages', 'maxTouchPoints', 'vendor', 'productSub',
    'cookieEnabled', 'doNotTrack',
  ];
  FP_PROPS.forEach(prop => {
    try {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
      if (desc && desc.get) {
        Object.defineProperty(Navigator.prototype, prop, {
          get() {
            fpPropsRead.add(prop);
            if (fpPropsRead.size === FP_THRESHOLD) notify('navigator_fingerprint');
            return desc.get.call(this);
          },
          configurable: true,
        });
      }
    } catch (_) {}
  });

})();
