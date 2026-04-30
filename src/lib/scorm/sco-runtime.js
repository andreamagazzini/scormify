/**
 * SCORM 1.2 SCO runtime: discovers parent LMS API, completion and optional quiz scoring.
 * Dependency-free for broad LMS compatibility (same pattern as pipwerks-style discovery).
 */
(function () {
  "use strict";

  function findAPI(win) {
    var n = 0;
    var max = 500;
    var w = win;
    while (w && n < max) {
      n += 1;
      try {
        if (w.API) {
          return w.API;
        }
      } catch {
        /* cross-origin */
      }
      if (w.parent && w.parent !== w) {
        w = w.parent;
      } else {
        break;
      }
    }
    return null;
  }

  var cached = null;

  function getApi() {
    if (cached) {
      return cached;
    }
    cached = findAPI(window);
    return cached;
  }

  function init() {
    var a = getApi();
    if (!a) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "SCORM: API not found. Open this SCO from an LMS to record status."
        );
      }
      return false;
    }
    var r = a.LMSInitialize("");
    return r === "true" || r === true;
  }

  function markCompleteOnly() {
    var a = getApi();
    if (!a) {
      return false;
    }
    a.LMSSetValue("cmi.core.lesson_status", "completed");
    a.LMSCommit("");
    a.LMSFinish("");
    return true;
  }

  /**
   * Report quiz percentage score (0–100) and pass/fail against manifest mastery.
   */
  function submitQuizScore(percentInt, passed) {
    var a = getApi();
    if (!a) {
      return false;
    }
    var p = String(Math.max(0, Math.min(100, Math.round(percentInt))));
    a.LMSSetValue("cmi.core.score.min", "0");
    a.LMSSetValue("cmi.core.score.max", "100");
    a.LMSSetValue("cmi.core.score.raw", p);
    a.LMSSetValue(
      "cmi.core.lesson_status",
      passed ? "passed" : "failed"
    );
    a.LMSCommit("");
    a.LMSFinish("");
    return true;
  }

  window.ScoRuntime = {
    init: init,
    markComplete: markCompleteOnly,
    submitQuizScore: submitQuizScore,
    getApi: getApi,
  };

  document.addEventListener("DOMContentLoaded", function () {
    init();
    initSlideshow();
    var cfg = window.__SCO_QUIZ__;
    if (
      cfg &&
      cfg.questions &&
      cfg.questions.length &&
      document.getElementById("sco-quiz-form")
    ) {
      wireQuiz(cfg);
    } else {
      wireMarkComplete();
    }
  });

  function initSlideshow() {
    var slides = document.querySelectorAll(".sco-slide");
    if (!slides.length) {
      return;
    }
    var prev = document.getElementById("sco-prev");
    var next = document.getElementById("sco-next");
    var counter = document.getElementById("sco-slide-counter");
    if (!prev || !next) {
      return;
    }
    var total = slides.length;
    var idx = 0;
    function show(i) {
      if (i < 0) {
        i = 0;
      }
      if (i >= total) {
        i = total - 1;
      }
      idx = i;
      for (var s = 0; s < total; s += 1) {
        slides[s].hidden = s !== idx;
      }
      if (counter) {
        counter.textContent = idx + 1 + " / " + total;
      }
      prev.disabled = idx <= 0;
      next.disabled = idx >= total - 1;
    }
    show(0);
    prev.addEventListener("click", function () {
      show(idx - 1);
    });
    next.addEventListener("click", function () {
      show(idx + 1);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") {
        show(idx - 1);
      } else if (e.key === "ArrowRight") {
        show(idx + 1);
      }
    });
  }

  function wireMarkComplete() {
    var btn = document.getElementById("sco-complete");
    if (btn) {
      btn.addEventListener("click", function () {
        if (!markCompleteOnly() && getApi() == null) {
          alert("SCORM API not available (preview this package in an LMS).");
        }
      });
    }
  }

  function normalizeAnswer(s) {
    return String(s)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function numArraysEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  function gradeQuestion(form, index, stub) {
    var kind = stub.kind;
    if (kind === "choice" || kind === "true_false") {
      var chosen = form.querySelector(
        'input[name="sco_q_' + index + '"]:checked'
      );
      if (!chosen) {
        return { answered: false, correct: false };
      }
      if (kind === "choice") {
        return {
          answered: true,
          correct: parseInt(chosen.value, 10) === stub.correctIndex,
        };
      }
      var userTrue = chosen.value === "1";
      return { answered: true, correct: userTrue === stub.correctTrue };
    }
    if (kind === "multi") {
      var boxes = form.querySelectorAll(
        'input[name="sco_q_' + index + '_m"]'
      );
      var selected = [];
      for (var b = 0; b < boxes.length; b += 1) {
        if (boxes[b].checked) {
          selected.push(parseInt(boxes[b].value, 10));
        }
      }
      selected.sort(function (x, y) {
        return x - y;
      });
      var expected = stub.correctIndices
        .slice()
        .sort(function (x, y) {
          return x - y;
        });
      return {
        answered: true,
        correct: numArraysEqual(selected, expected),
      };
    }
    if (kind === "short") {
      var inp = form.querySelector(
        'input[name="sco_q_' + index + '_short"]'
      );
      if (!inp) {
        return { answered: false, correct: false };
      }
      var raw = inp.value;
      if (!String(raw).trim()) {
        return { answered: false, correct: false };
      }
      var n = normalizeAnswer(raw);
      var ok = false;
      for (var k = 0; k < stub.acceptableAnswers.length; k += 1) {
        if (n === stub.acceptableAnswers[k]) {
          ok = true;
          break;
        }
      }
      return { answered: true, correct: ok };
    }
    return { answered: false, correct: false };
  }

  function wireQuiz(cfg) {
    var form = document.getElementById("sco-quiz-form");
    var feedback = document.getElementById("sco-quiz-feedback");
    if (!form || !cfg.questions || !cfg.questions.length) {
      return;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var stubs = cfg.questions;
      var total = stubs.length;
      var correct = 0;
      for (var i = 0; i < total; i += 1) {
        var r = gradeQuestion(form, i, stubs[i]);
        if (!r.answered) {
          if (feedback) {
            feedback.hidden = false;
            feedback.textContent = "Please answer every question.";
          }
          return;
        }
        if (r.correct) {
          correct += 1;
        }
      }
      var pct = total === 0 ? 100 : Math.round((correct / total) * 100);
      var mastery = cfg.masteryPercent;
      if (typeof mastery !== "number" || mastery !== mastery) {
        mastery = 80;
      }
      var passed = pct >= mastery;
      var ok = submitQuizScore(pct, passed);
      if (feedback) {
        feedback.hidden = false;
        feedback.textContent = ok
          ? "Score: " +
            pct +
            "%. " +
            (passed ? "Passed." : "Below mastery — not passed.")
          : "Could not reach the LMS SCORM API.";
      }
      var sub = document.getElementById("sco-quiz-submit");
      if (sub) {
        sub.disabled = true;
      }
      var inputs = form.querySelectorAll("input");
      for (var j = 0; j < inputs.length; j += 1) {
        inputs[j].disabled = true;
      }
    });
  }
})();
