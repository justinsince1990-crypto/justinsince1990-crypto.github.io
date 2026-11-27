/* Disciple Course study companion — persistence and adaptive study logic.
   Safe in both the browser and Node tests. */
(function (root) {
  var KEY = 'disciple-course-v1';
  var DC = { KEY: KEY, VERSION: 1 };

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function blankState() {
    return {
      version: 1,
      theme: 'auto',
      progress: {},
      ratings: {},
      quiz: {
        missed: [],
        marked: [],
        lastAnswers: {},
        sessions: [],
        best: null
      },
      cards: { status: {} },
      notes: {},
      anjana: {}
    };
  }

  function asStringArray(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) { return typeof x === 'string'; });
  }

  function asMap(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    return out;
  }

  function migrate(raw) {
    var s = blankState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
    if (raw.theme === 'day' || raw.theme === 'dusk' || raw.theme === 'oled' || raw.theme === 'auto') {
      s.theme = raw.theme;
    }
    s.progress = asMap(raw.progress);
    Object.keys(s.progress).forEach(function (k) { s.progress[k] = !!s.progress[k]; });
    s.ratings = asMap(raw.ratings);
    Object.keys(s.ratings).forEach(function (k) {
      if (s.ratings[k] !== 'needs' && s.ratings[k] !== 'learning' && s.ratings[k] !== 'solid') delete s.ratings[k];
    });
    var q = raw.quiz && typeof raw.quiz === 'object' ? raw.quiz : {};
    s.quiz.missed = asStringArray(q.missed);
    s.quiz.marked = asStringArray(q.marked);
    s.quiz.lastAnswers = asMap(q.lastAnswers);
    s.quiz.sessions = Array.isArray(q.sessions) ? q.sessions.filter(function (sess) {
      return sess && typeof sess === 'object' && typeof sess.correct === 'number' && typeof sess.total === 'number';
    }).map(function (sess) {
      return { correct: sess.correct, total: sess.total, at: sess.at || null, filter: sess.filter || null };
    }) : [];
    if (q.best && typeof q.best === 'object' && typeof q.best.correct === 'number' && typeof q.best.total === 'number') {
      s.quiz.best = { correct: q.best.correct, total: q.best.total, at: q.best.at || null, pct: q.best.pct };
    }
    var c = raw.cards && typeof raw.cards === 'object' ? raw.cards : {};
    s.cards.status = asMap(c.status);
    Object.keys(s.cards.status).forEach(function (k) {
      if (s.cards.status[k] !== 'got' && s.cards.status[k] !== 'again') delete s.cards.status[k];
    });
    s.notes = asMap(raw.notes);
    Object.keys(s.notes).forEach(function (k) {
      if (typeof s.notes[k] !== 'string') s.notes[k] = String(s.notes[k] == null ? '' : s.notes[k]);
    });
    s.anjana = asMap(raw.anjana);
    Object.keys(s.anjana).forEach(function (k) {
      if (typeof s.anjana[k] !== 'string') s.anjana[k] = String(s.anjana[k] == null ? '' : s.anjana[k]);
    });
    s.version = 1;
    return s;
  }

  function unique(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      if (!seen[x]) { seen[x] = true; out.push(x); }
    });
    return out;
  }

  function getRating(state, topicId) {
    return (state && state.ratings && state.ratings[topicId]) || 'unreviewed';
  }

  function setRating(state, topicId, rating) {
    if (rating !== 'needs' && rating !== 'learning' && rating !== 'solid' && rating !== 'unreviewed') return state;
    if (rating === 'unreviewed') delete state.ratings[topicId];
    else state.ratings[topicId] = rating;
    return state;
  }

  function setProgress(state, id, done) {
    state.progress[id] = !!done;
    return state;
  }

  function confRank(c) {
    if (c === 'needs') return 0;
    if (c === 'unreviewed') return 1;
    if (c === 'learning') return 2;
    return 3;
  }

  function adaptiveQueue(state, topics) {
    return topics.slice().sort(function (a, b) {
      var d = confRank(getRating(state, a.id)) - confRank(getRating(state, b.id));
      if (d !== 0) return d;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function mastery(state, topics) {
    var needs = 0, learning = 0, solid = 0, unreviewed = 0;
    topics.forEach(function (t) {
      var c = getRating(state, t.id);
      if (c === 'needs') needs += 1;
      else if (c === 'learning') learning += 1;
      else if (c === 'solid') solid += 1;
      else unreviewed += 1;
    });
    return { needs: needs, learning: learning, solid: solid, unreviewed: unreviewed, rated: topics.length - unreviewed, total: topics.length };
  }

  function progressStats(state, lessonIds) {
    var done = 0;
    lessonIds.forEach(function (id) { if (state.progress[id]) done += 1; });
    return { done: done, total: lessonIds.length, pct: lessonIds.length ? Math.round((done / lessonIds.length) * 100) : 0 };
  }

  function quizOrder(state, questions, filter) {
    var base = questions.slice();
    if (filter && filter !== 'all' && filter !== 'adaptive') {
      base = base.filter(function (q) { return q.unit === filter; });
    }
    if (filter !== 'adaptive') return base;
    var missed = (state.quiz && state.quiz.missed) || [];
    var marked = (state.quiz && state.quiz.marked) || [];
    return base.sort(function (a, b) {
      var aHot = missed.indexOf(a.id) >= 0 || marked.indexOf(a.id) >= 0 ? 0 : 1;
      var bHot = missed.indexOf(b.id) >= 0 || marked.indexOf(b.id) >= 0 ? 0 : 1;
      if (aHot !== bHot) return aHot - bHot;
      var aConf = getRating(state, a.topicId);
      var bConf = getRating(state, b.topicId);
      var aPri = (aConf === 'needs' || aConf === 'unreviewed') ? 0 : confRank(aConf);
      var bPri = (bConf === 'needs' || bConf === 'unreviewed') ? 0 : confRank(bConf);
      if (aPri !== bPri) return aPri - bPri;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function recordAnswer(state, qid, topicId, correct, choice) {
    state.quiz.lastAnswers[qid] = choice;
    if (!correct) {
      state.quiz.missed = unique(state.quiz.missed.concat([qid]));
      if (getRating(state, topicId) === 'unreviewed' || getRating(state, topicId) === 'solid') {
        setRating(state, topicId, 'needs');
      }
    } else {
      state.quiz.missed = state.quiz.missed.filter(function (id) { return id !== qid; });
    }
    return state;
  }

  function markReview(state, qid) {
    state.quiz.marked = unique(state.quiz.marked.concat([qid]));
    return state;
  }

  function unmarkReview(state, qid) {
    state.quiz.marked = state.quiz.marked.filter(function (id) { return id !== qid; });
    return state;
  }

  function recordQuizSession(state, correct, total, filter, at) {
    var sess = { correct: correct, total: total, filter: filter || 'all', at: at || null };
    sess.pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    state.quiz.sessions = state.quiz.sessions.concat([sess]).slice(-20);
    var best = state.quiz.best;
    if (!best || sess.pct > (best.pct || 0) || (sess.pct === (best.pct || 0) && correct > best.correct)) {
      state.quiz.best = { correct: correct, total: total, pct: sess.pct, at: sess.at };
    }
    return state;
  }

  function cardQueue(state, cards) {
    var status = (state.cards && state.cards.status) || {};
    function rank(id) {
      var s = status[id];
      if (s === 'again' || !s) return s === 'again' ? 0 : 1;
      return 2;
    }
    return cards.slice().sort(function (a, b) {
      var d = rank(a.id) - rank(b.id);
      if (d !== 0) return d;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function rateCard(state, cardId, gotIt, topicId) {
    state.cards.status[cardId] = gotIt ? 'got' : 'again';
    if (!gotIt && topicId && (getRating(state, topicId) === 'unreviewed' || getRating(state, topicId) === 'solid')) {
      setRating(state, topicId, 'needs');
    }
    return state;
  }

  function cardStats(state, cards) {
    var got = 0, again = 0, fresh = 0;
    cards.forEach(function (c) {
      var s = state.cards.status[c.id];
      if (s === 'got') got += 1;
      else if (s === 'again') again += 1;
      else fresh += 1;
    });
    return { got: got, again: again, fresh: fresh, total: cards.length };
  }

  function setNote(state, lessonId, text) {
    state.notes[lessonId] = text || '';
    return state;
  }

  function setAnjana(state, lessonId, text) {
    state.anjana[lessonId] = text || '';
    return state;
  }

  function exportBackup(state) {
    return JSON.stringify(state, null, 2);
  }

  function importBackup(jsonString) {
    var raw;
    try {
      raw = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('That file is not valid JSON.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('That backup does not look like a Disciple Course save.');
    }
    return migrate(raw);
  }

  function resolveTheme(pref, hour) {
    if (pref === 'day' || pref === 'dusk' || pref === 'oled') return pref;
    if (hour >= 21 || hour < 7) return 'oled';
    if (hour >= 17) return 'dusk';
    return 'day';
  }

  function themeLabel(pref, hour) {
    var th = resolveTheme(pref, hour);
    var name = th === 'day' ? 'Warm Daylight' : th === 'oled' ? 'OLED Pitch Black' : 'Dusk';
    return (pref === 'auto' ? 'Auto · ' : '') + name;
  }

  function themeColor(th) {
    if (th === 'day') return '#f7efe1';
    if (th === 'oled') return '#000000';
    return '#0b1530';
  }

  function obsidianMarkdown(state, data, lessonId) {
    var lines = [];
    var lessons = data.lessons || [];
    var topics = data.topics || [];
    function one(lesson) {
      lines.push('# IDC — ' + lesson.label);
      lines.push('');
      lines.push('Progress: ' + (state.progress[lesson.id] ? 'Completed' : 'In progress / upcoming'));
      if (lesson.topicIds && lesson.topicIds.length) {
        lines.push('Confidence:');
        lesson.topicIds.forEach(function (tid) {
          var t = topics.filter(function (x) { return x.id === tid; })[0];
          var label = t ? t.title : tid;
          var r = getRating(state, tid);
          var word = r === 'needs' ? 'Needs Review' : r === 'learning' ? 'Learning' : r === 'solid' ? 'Solid' : 'Not yet rated';
          lines.push('- ' + label + ': ' + word);
        });
      }
      lines.push('');
      lines.push('## My takeaways');
      lines.push(state.notes[lesson.id] && state.notes[lesson.id].trim() ? state.notes[lesson.id].trim() : '- ');
      lines.push('');
      lines.push('## Questions for Anjana');
      lines.push(state.anjana[lesson.id] && state.anjana[lesson.id].trim() ? state.anjana[lesson.id].trim() : '- ');
      lines.push('');
    }
    if (lessonId) {
      var hit = lessons.filter(function (l) { return l.id === lessonId; })[0];
      if (hit) one(hit);
    } else {
      lines.push('# ISKCON Disciple Course — personal notes');
      lines.push('');
      lines.push('These are my own words for the Vaishnava_Study vault. No course or book wording is copied here.');
      lines.push('');
      lessons.forEach(one);
    }
    return lines.join('\n');
  }

  DC.clone = clone;
  DC.blankState = blankState;
  DC.migrate = migrate;
  DC.getRating = getRating;
  DC.setRating = setRating;
  DC.setProgress = setProgress;
  DC.confRank = confRank;
  DC.adaptiveQueue = adaptiveQueue;
  DC.mastery = mastery;
  DC.progressStats = progressStats;
  DC.quizOrder = quizOrder;
  DC.recordAnswer = recordAnswer;
  DC.markReview = markReview;
  DC.unmarkReview = unmarkReview;
  DC.recordQuizSession = recordQuizSession;
  DC.cardQueue = cardQueue;
  DC.rateCard = rateCard;
  DC.cardStats = cardStats;
  DC.setNote = setNote;
  DC.setAnjana = setAnjana;
  DC.exportBackup = exportBackup;
  DC.importBackup = importBackup;
  DC.resolveTheme = resolveTheme;
  DC.themeLabel = themeLabel;
  DC.themeColor = themeColor;
  DC.obsidianMarkdown = obsidianMarkdown;

  if (typeof module !== 'undefined' && module.exports) module.exports = DC;
  else root.DC = DC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
