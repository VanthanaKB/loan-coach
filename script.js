/* ===================================================
   Loan Coach — script
   Everything runs in the browser. No server, no data stored.
   The settings you may want to change are at the top.
=================================================== */
(function () {
  'use strict';

  /* ---------- Settings ---------- */
  var BRAND = 'Loan Coach';
  var LIMIT = 0.40;          // total EMIs should stay within 40% of the lowest month
  var AMBER_LIMIT = 0.55;    // up to 55% counts as "almost there"
  var MIN_CONS = 0.75;       // lenders like at least 75% of weeks earned
  var WEAK_CONS = 0.60;      // below 60% is a weak record
  var SWING_RATIO = 0.60;    // lowest month under 60% of the average = big swings
  var MAX_LOANS = 5;
  var MAX_SIM = 600;         // longest payoff we simulate, in months
  var MAX_WAIT = 60;         // longest wait we show on the roadmap, in months
  var MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

  var CHECKLIST = [
    { id: 'id', t: 'ID proof', d: 'Aadhaar or PAN card' },
    { id: 'bank', t: 'Bank statement', d: 'Last 6 months' },
    { id: 'payout', t: 'Platform payout statements', d: 'Weekly or monthly, last 6 months' },
    { id: 'address', t: 'Address proof', d: 'Rent agreement or a utility bill' },
    { id: 'passport', t: 'Your Income Passport summary', d: 'Take a screenshot of the Income Passport above' },
    { id: 'loans', t: 'Details of your current loans', d: 'Statements that show balance and EMI' }
  ];

  /* ---------- Sample people (all made up) ---------- */
  var PEOPLE = {
    ravi: {
      name: 'Ravi', role: 'Delivery partner',
      months: [22000, 26000, 18000, 28000, 24000, 25000], weeks: 24,
      loans: [
        { name: 'Phone loan', balance: 14000, emi: 2000, rate: 20 },
        { name: 'Pay-later app', balance: 6000, emi: 1000, rate: 30 }
      ],
      loan: 60000, tenure: 12, rate: 18
    },
    meena: {
      name: 'Meena', role: 'Freelance designer',
      months: [15000, 32000, 9000, 27000, 12000, 30000], weeks: 20,
      loans: [{ name: 'Credit card dues', balance: 9000, emi: 1500, rate: 36 }],
      loan: 80000, tenure: 12, rate: 18
    },
    imran: {
      name: 'Imran', role: 'Cab driver',
      months: [30000, 31000, 29000, 32000, 30000, 33000], weeks: 26,
      loans: [{ name: 'Bike loan', balance: 60000, emi: 4000, rate: 14 }],
      loan: 60000, tenure: 12, rate: 18
    },
    custom: {
      name: 'You', role: 'Your own details',
      months: [15000, 15000, 15000, 15000, 15000, 15000], weeks: 20,
      loans: [],
      loan: 50000, tenure: 12, rate: 18
    }
  };

  var nextId = 1;
  var state = fromPerson('ravi');
  var checks = {};

  /* ---------- Small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function floorTo(n, step) { return isFinite(n) ? Math.max(0, Math.floor(n / step) * step) : 0; }
  function inr(n) {
    n = Math.round(n);
    return (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
  }
  function pct(x) { return isFinite(x) ? Math.round(x * 100) + '%' : 'all'; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function monthsFromNow(k) {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + k);
    return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
  }
  function levelWord(l) { return l === 'green' ? 'Likely eligible' : l === 'amber' ? 'Almost there' : 'Not yet'; }
  function kfmt(v) { return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v)); }

  function fromPerson(key) {
    var p = PEOPLE[key];
    return {
      personKey: key,
      name: p.name,
      role: p.role,
      months: p.months.slice(),
      weeks: p.weeks,
      loans: p.loans.map(function (l) {
        return { id: nextId++, name: l.name, balance: l.balance, emi: l.emi, rate: l.rate };
      }),
      loan: p.loan,
      tenure: p.tenure,
      rate: p.rate,
      extra: 0,
      drop: 30
    };
  }

  /* ---------- Money maths ---------- */
  // EMI for each rupee borrowed
  function factor(ratePct, n) {
    var r = ratePct / 1200;
    if (r <= 0) return 1 / n;
    var g = Math.pow(1 + r, n);
    return r * g / (g - 1);
  }

  function readiness(min, avg, cons, share) {
    var headroom = isFinite(share) ? clamp(1 - share / 0.6, 0, 1) * 40 : 0;
    var stability = avg > 0 ? clamp(min / avg, 0, 1) * 20 : 0;
    return Math.round(cons * 40 + headroom + stability);
  }

  function evaluate(min, avg, cons, existing, loan, tenure, rate) {
    var f = factor(rate, tenure);
    var newEmi = loan * f;
    var limit = LIMIT * min;
    var share = min > 0 ? (existing + newEmi) / min : Infinity;
    var level = 'red';
    if (min > 0) {
      if (share <= LIMIT && cons >= MIN_CONS) level = 'green';
      else if (share <= AMBER_LIMIT && cons >= WEAK_CONS) level = 'amber';
    }
    return {
      f: f, newEmi: newEmi, limit: limit, share: share, level: level,
      safeMax: floorTo((limit - existing) / f, 500),
      score: readiness(min, avg, cons, share)
    };
  }

  // Month-by-month payoff. If extra > 0, the extra money plus any freed-up EMIs
  // go to the smallest balance first (it frees EMIs soonest).
  function simulate(loans, extra) {
    var L = loans.map(function (l) {
      return { id: l.id, name: l.name, balance0: l.balance, emi: l.emi, rate: l.rate, bal: l.balance, clear: l.balance <= 0 ? 0 : null };
    });
    var active = L.filter(function (l) { return l.clear === null; }).length;
    var interest = 0, month = 0, freed = 0, i;
    while (active > 0 && month < MAX_SIM) {
      month++;
      for (i = 0; i < L.length; i++) {
        if (L[i].clear !== null) continue;
        var intr = L[i].bal * L[i].rate / 1200;
        L[i].bal += intr;
        interest += intr;
        L[i].bal -= Math.min(L[i].emi, L[i].bal);
      }
      var pool = extra > 0 ? extra + freed : 0;
      if (pool > 0) {
        var order = L.filter(function (l) { return l.clear === null && l.bal > 0.005; })
          .sort(function (a, b) { return a.bal - b.bal; });
        for (i = 0; i < order.length && pool > 0; i++) {
          var p = Math.min(pool, order[i].bal);
          order[i].bal -= p;
          pool -= p;
        }
      }
      for (i = 0; i < L.length; i++) {
        if (L[i].clear === null && L[i].bal <= 0.005) {
          L[i].clear = month;
          active--;
          if (extra > 0) freed += L[i].emi;
        }
      }
    }
    var months = 0, allClear = true;
    L.forEach(function (l) {
      if (l.clear === null) allClear = false; else months = Math.max(months, l.clear);
    });
    return { loans: L, months: allClear ? months : null, interest: interest };
  }

  function obligationAt(sim, k) {
    var t = 0;
    sim.loans.forEach(function (l) { if (l.clear === null || l.clear > k) t += l.emi; });
    return t;
  }

  function qualifyMonth(sim, newEmi, limit) {
    var pts = [0];
    sim.loans.forEach(function (l) { if (l.clear !== null && l.clear > 0 && l.clear <= MAX_WAIT) pts.push(l.clear); });
    pts.sort(function (a, b) { return a - b; });
    for (var i = 0; i < pts.length; i++) {
      if (obligationAt(sim, pts[i]) + newEmi <= limit + 1e-9) return pts[i];
    }
    return null;
  }

  // Which loans could be paid off so the full ask fits?
  function payoffOptions(loans, existing, min, avg, cons, ask, tenure, rate, newEmi, limit) {
    var n = loans.length, all = [], best = null;
    for (var mask = 1; mask < (1 << n); mask++) {
      var cost = 0, freed = 0, names = [], count = 0;
      for (var j = 0; j < n; j++) {
        if (mask & (1 << j)) { cost += loans[j].balance; freed += loans[j].emi; names.push(loans[j].name); count++; }
      }
      var existingAfter = Math.max(0, existing - freed);
      var ev = evaluate(min, avg, cons, existingAfter, ask, tenure, rate);
      var fits = min > 0 && existingAfter + newEmi <= limit + 1e-9;
      var o = { mask: mask, count: count, names: names, cost: cost, freed: freed, existingAfter: existingAfter, safe: ev.safeMax, fits: fits };
      all.push(o);
      if (fits && (!best || cost < best.cost || (cost === best.cost && count < best.count))) best = o;
    }
    var singles = all.filter(function (o) { return o.count === 1; })
      .sort(function (a, b) { return a.cost - b.cost; });
    return { all: all, singles: singles, best: best };
  }

  /* ---------- The model: every number the page shows ---------- */
  function buildModel(s) {
    var months = s.months.map(num);
    var min = Math.min.apply(null, months);
    var avg = months.reduce(function (a, b) { return a + b; }, 0) / months.length;
    var weeks = clamp(Math.round(num(s.weeks)), 0, 26);
    var cons = weeks / 26;
    var loans = s.loans.map(function (l, i) {
      return { id: l.id, name: String(l.name || '').trim() || 'Loan ' + (i + 1), balance: num(l.balance), emi: num(l.emi), rate: num(l.rate) };
    });
    var existing = loans.reduce(function (a, l) { return a + l.emi; }, 0);
    var ask = num(s.loan), tenure = s.tenure, rate = num(s.rate);
    var now = evaluate(min, avg, cons, existing, ask, tenure, rate);
    var extra = num(s.extra);
    var plan = simulate(loans, extra);
    var base = simulate(loans, 0);
    var opts = payoffOptions(loans, existing, min, avg, cons, ask, tenure, rate, now.newEmi, now.limit);
    var fitsNow = min > 0 && now.share <= LIMIT;
    var totalBalance = loans.reduce(function (a, l) { return a + l.balance; }, 0);

    // "After the plan" scenario
    var after = { kind: 'none', existingAfter: existing, loanAfter: ask, steps: [] };
    if (min > 0 && !fitsNow) {
      if (opts.best) {
        after.kind = 'payoff';
        after.existingAfter = opts.best.existingAfter;
        after.steps.push('Pay off ' + opts.best.names.join(' and ') + ' (' + inr(opts.best.cost) + ')');
        after.steps.push('Borrow ' + inr(ask) + ' over ' + tenure + ' months');
      } else if (now.safeMax > 0) {
        after.kind = 'less';
        after.loanAfter = Math.min(ask, now.safeMax);
        after.steps.push('Borrow ' + inr(after.loanAfter) + ' instead of ' + inr(ask));
      } else {
        var safe0 = floorTo(now.limit / now.f, 500);
        if (loans.length && safe0 > 0) {
          after.kind = 'clear-all';
          after.existingAfter = 0;
          after.loanAfter = Math.min(ask, safe0);
          after.steps.push('Pay off all your loans (' + inr(totalBalance) + ')');
          after.steps.push('Borrow ' + inr(after.loanAfter));
        }
      }
    }
    if (after.kind === 'none') after.steps.push(fitsNow ? 'Apply for ' + inr(ask) + ' with your documents ready' : 'Raise your earnings or lower the amount to see a plan');
    if (cons < MIN_CONS) after.steps.push('Earn in at least 20 of 26 weeks');
    after.ev = evaluate(min, avg, cons, after.existingAfter, after.loanAfter, tenure, rate);

    return {
      s: s, months: months, min: min, avg: avg, weeks: weeks, cons: cons,
      loans: loans, existing: existing, ask: ask, tenure: tenure, rate: rate, extra: extra,
      now: now, plan: plan, base: base, opts: opts, fitsNow: fitsNow, after: after, totalBalance: totalBalance
    };
  }

  /* ---------- Rejection reasons ---------- */
  function bestToClear(m) {
    var best = null;
    m.loans.forEach(function (l) {
      if (l.balance > 0 && l.emi > 0) {
        var eff = l.emi / l.balance;
        if (!best || eff > best.eff) best = { loan: l, eff: eff };
      }
    });
    return best ? best.loan : null;
  }

  function buildReasons(m) {
    var r = [];
    if (m.min <= 0) {
      return [{ sev: 'high', title: 'No earnings entered', detail: 'Loan Coach needs your monthly earnings to check a loan.', fix: 'Add your last six months of earnings.' }];
    }
    var share = m.now.share;
    if (share > LIMIT) {
      r.push({
        sev: share > AMBER_LIMIT ? 'high' : 'medium',
        title: 'Your EMIs would be too high',
        detail: 'With this loan, your EMIs would take ' + pct(share) + ' of your lowest month (' + inr(m.min) + '). Lenders prefer under 40%.',
        fix: m.now.safeMax > 0
          ? 'Ask for up to ' + inr(m.now.safeMax) + ', or clear a loan first. See the Approval Roadmap.'
          : 'There is no room for a new EMI right now. Reduce your existing EMIs first.'
      });
    }
    var existShare = m.existing / m.min;
    if (m.existing > 0 && existShare > 0.30) {
      var pick = bestToClear(m);
      r.push({
        sev: existShare > LIMIT ? 'high' : 'medium',
        title: 'You already pay a lot in EMIs',
        detail: 'Your current loans take ' + pct(existShare) + ' of your lowest month, before the new loan.',
        fix: pick ? 'Clear ' + esc(pick.name) + ' first. It frees ' + inr(pick.emi) + ' a month for ' + inr(pick.balance) + '.' : 'Reduce your existing EMIs first.'
      });
    }
    if (m.cons < MIN_CONS) {
      r.push({
        sev: m.cons < WEAK_CONS ? 'high' : 'medium',
        title: 'You earned in only ' + m.weeks + ' of 26 weeks',
        detail: 'That is ' + pct(m.cons) + '. Lenders like to see regular earning, at least 75%.',
        fix: 'Try to earn in at least 20 of 26 weeks before you apply, and keep a payout statement for every week.'
      });
    }
    if (m.avg > 0 && m.min / m.avg < SWING_RATIO) {
      r.push({
        sev: 'medium',
        title: 'Your earnings swing a lot',
        detail: 'Your lowest month (' + inr(m.min) + ') is far below your average (' + inr(m.avg) + '). Lenders worry about the bad months.',
        fix: 'Aim for a lowest month above 60% of your average, or apply for a smaller amount. Loan Coach sizes loans to your lowest month.'
      });
    }
    if (m.loans.length >= 3) {
      r.push({
        sev: 'medium',
        title: 'Several loans are open at once',
        detail: 'You have ' + m.loans.length + ' active loans. Many open loans can look stretched to a lender.',
        fix: 'Clear the smallest one first. See the Debt-Free Plan.'
      });
    }
    m.loans.forEach(function (l) {
      if (l.balance > 0 && l.emi > 0 && l.emi <= l.balance * l.rate / 1200) {
        r.push({
          sev: 'high',
          title: esc(l.name) + ' barely reduces',
          detail: 'Its EMI of ' + inr(l.emi) + ' only covers the interest, so the balance does not shrink.',
          fix: 'Ask the lender about a higher EMI or a settlement, or pay extra on this loan.'
        });
      }
    });
    if (!r.length) {
      r.push({
        sev: 'good',
        title: 'No red flags found',
        detail: inr(m.ask) + ' fits within your lowest month, and you earn regularly.',
        fix: 'Keep your documents ready and compare offers before you sign.'
      });
    }
    r.push({
      sev: 'low',
      title: 'Income proof without payslips',
      detail: 'Lenders usually ask for payslips or tax returns. Many gig workers have neither.',
      fix: 'Bring 6 months of payout statements and a bank statement. The Income Passport below is a clear summary to show.'
    });
    var order = { good: 0, high: 1, medium: 2, low: 3 };
    return r.map(function (x, i) { x.i = i; return x; })
      .sort(function (a, b) { return order[a.sev] - order[b.sev] || a.i - b.i; });
  }

  /* ---------- Rendering ---------- */
  var SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Tip', good: 'Good' };

  function renderHero() {
    var m = buildModel(fromPerson('ravi'));
    $('hvMeter').className = 'meter lvl-' + m.now.level;
    $('hvVerdict').textContent = levelWord(m.now.level);
    $('hvSafe').textContent = inr(m.now.safeMax) + ' over ' + m.tenure + ' months (he asked for ' + inr(m.ask) + ')';
    $('hvWhy').textContent = 'EMIs would take ' + pct(m.now.share) + ' of his lowest month. Lenders prefer under 40%.';
    $('hvPlan').textContent = m.opts.best
      ? 'Pay off ' + m.opts.best.names.join(' and ') + ' (' + inr(m.opts.best.cost) + ') and the full ' + inr(m.ask) + ' fits.'
      : 'Borrow ' + inr(m.now.safeMax) + ' now.';
    document.querySelector('.hero-card').classList.toggle('lvl-green', m.now.level === 'green');
  }

  function renderVerdict(m) {
    var lv = m.now.level, line;
    if (m.min <= 0) line = 'Add your monthly earnings to see a result.';
    else if (lv === 'green') line = inr(m.ask) + ' fits within your safe limit of ' + inr(m.now.safeMax) + '.';
    else if (m.fitsNow) line = 'Your EMIs fit, but lenders also want to see regular earning. Earning in more weeks will help.';
    else line = inr(m.ask) + ' is above your safe limit of ' + inr(m.now.safeMax) + '. See the roadmap below.';

    var safeSub = m.now.safeMax > 0
      ? 'over ' + m.tenure + ' months, keeping all EMIs within 40% of your lowest month (' + inr(m.now.limit) + ')'
      : 'There is no room for a new EMI right now. See the plan below.';
    var score = clamp(m.now.score, 0, 100);

    $('verdictBody').innerHTML =
      '<div class="verdict-top">' +
        '<div class="safe-badge"><span class="sb-label">Safe loan for you</span>' +
          '<span class="sb-amount">' + inr(m.now.safeMax) + '</span>' +
          '<span class="sb-sub">' + safeSub + '</span></div>' +
        '<div class="verdict-box"><div class="meter lvl-' + lv + '" aria-hidden="true"><span></span><span></span><span></span></div>' +
          '<span class="verdict-word lvl-' + lv + '">' + levelWord(lv) + '</span>' +
          '<p class="verdict-line">' + line + '</p></div>' +
      '</div>' +
      '<div class="score-row"><div class="score-head"><span>Readiness score</span><strong>' + score + ' / 100</strong></div>' +
        '<div class="score-track" aria-hidden="true"><span style="width:' + score + '%"></span></div>' +
        '<p class="score-note">Based on how regularly you earn, how much room your EMIs leave, and how much your income swings.</p></div>';
  }

  function renderDecoder(m) {
    var reasons = buildReasons(m);
    var real = reasons.filter(function (x) { return x.sev === 'high' || x.sev === 'medium'; }).length;
    var summary = real === 0 ? 'No major reasons to expect a no.' : plural(real, 'reason') + ' a lender may say no:';
    $('decoderBody').innerHTML =
      '<p class="decoder-summary">' + summary + '</p><ul class="reasons">' +
      reasons.map(function (x) {
        return '<li class="reason sev-' + x.sev + '"><div class="reason-top"><span class="pill pill-' + x.sev + '">' + SEV_LABEL[x.sev] + '</span><strong>' + x.title + '</strong></div>' +
          '<p>' + x.detail + '</p><p class="fix"><b>Fix:</b> ' + x.fix + '</p></li>';
      }).join('') + '</ul>';
  }

  function renderRoadmap(m) {
    var el = $('roadmapBody');
    if (m.min <= 0) { el.innerHTML = '<p class="empty">Add your monthly earnings to see a roadmap.</p>'; return; }

    var html = '';
    if (m.fitsNow) html += '<p class="roadmap-ok">Good news: ' + inr(m.ask) + ' already fits within 40% of your lowest month.</p>';

    // Route 1: borrow a safe amount
    var a;
    if (m.fitsNow) {
      a = '<span class="route-big">' + inr(m.ask) + '</span><p class="route-text">Your ask fits. The EMI would be ' + inr(m.now.newEmi) + ' a month.</p>';
    } else if (m.now.safeMax > 0) {
      a = '<span class="route-big">' + inr(m.now.safeMax) + '</span><p class="route-text">Instead of ' + inr(m.ask) + '. EMIs stay within 40% of your lowest month.</p>';
    } else {
      a = '<span class="route-big">' + inr(0) + '</span><p class="route-text">There is no room for a new EMI right now. Reduce your existing EMIs first.</p>';
    }

    // Route 2: pay off a loan first
    var b;
    if (!m.loans.length) {
      b = '<p class="route-text">You have no existing loans to pay off.</p>';
    } else if (m.fitsNow) {
      b = '<p class="route-text">Not needed. Your ask already fits.</p>';
    } else {
      var items = m.opts.singles.map(function (o) {
        return '<li><b>' + esc(o.names[0]) + '</b>: pay ' + inr(o.cost) + ' and your safe loan becomes ' + inr(o.safe) +
          (o.fits ? ' <span class="route-ok">The full ask fits.</span>' : '') + '</li>';
      });
      var anySingle = m.opts.singles.some(function (o) { return o.fits; });
      if (!anySingle && m.opts.best) {
        items.push('<li><b>' + esc(m.opts.best.names.join(' + ')) + '</b>: pay ' + inr(m.opts.best.cost) + ' <span class="route-ok">The full ask fits.</span></li>');
      }
      b = '<ul class="route-list">' + items.join('') + '</ul>';
      if (!m.opts.best) b += '<p class="route-text">Even with no other loans, ' + inr(m.ask) + ' is too large for your lowest month. Borrow less.</p>';
    }

    // Route 3: wait
    var qm = qualifyMonth(m.plan, m.now.newEmi, m.now.limit);
    var c;
    if (m.fitsNow) {
      c = '<span class="route-big">Now</span><p class="route-text">Your ask already fits.</p>';
    } else if (qm !== null && qm > 0) {
      c = '<span class="route-big">' + plural(qm, 'month') + '</span><p class="route-text">By ' + monthsFromNow(qm) + ' enough of your loans are repaid for the full ' + inr(m.ask) + ' to fit. ' +
        (m.extra > 0 ? 'This includes ' + inr(m.extra) + ' extra a month.' : 'Use the extra-payment slider in the Debt-Free Plan to get there sooner.') + '</p>';
    } else if (m.loans.length) {
      c = '<span class="route-big">Not by waiting</span><p class="route-text">Even after your loans end, ' + inr(m.ask) + ' is too large for your lowest month. Borrow less or earn more steadily.</p>';
    } else {
      c = '<span class="route-big">Not by waiting</span><p class="route-text">You have no loans to wait out. Earning more steadily raises what you can borrow.</p>';
    }

    html += '<div class="routes">' +
      '<div class="route' + (m.fitsNow ? ' is-best' : '') + '"><span class="route-tag">Today</span><h5 class="route-title">Borrow a safe amount</h5>' + a + '</div>' +
      '<div class="route"><span class="route-tag">Pay</span><h5 class="route-title">Pay off a loan first</h5>' + b + '</div>' +
      '<div class="route"><span class="route-tag">Wait</span><h5 class="route-title">Wait for loans to end</h5>' + c + '</div>' +
      '</div>';

    // Timeline
    var tl = '<ol class="timeline">';
    tl += '<li class="tl-item is-now' + (m.fitsNow ? ' is-goal' : '') + '"><span class="tl-dot"></span><strong>Today</strong><p>' +
      (m.fitsNow ? 'Your full ' + inr(m.ask) + ' fits. ' : 'Safe loan: ' + inr(m.now.safeMax) + '. ') +
      'Your EMIs now: ' + inr(m.existing) + ' a month.</p></li>';
    var byMonth = {};
    m.plan.loans.forEach(function (l) {
      if (l.clear !== null && l.clear > 0 && l.clear <= MAX_WAIT) (byMonth[l.clear] = byMonth[l.clear] || []).push(l.name);
    });
    var goalDone = m.fitsNow;
    Object.keys(byMonth).map(Number).sort(function (x, y) { return x - y; }).forEach(function (mo) {
      var obl = obligationAt(m.plan, mo);
      var safe = floorTo((m.now.limit - obl) / m.now.f, 500);
      var fits = obl + m.now.newEmi <= m.now.limit + 1e-9;
      var isGoal = fits && !goalDone;
      if (isGoal) goalDone = true;
      tl += '<li class="tl-item' + (isGoal ? ' is-goal' : '') + '"><span class="tl-dot"></span><strong>Month ' + mo + ' (' + monthsFromNow(mo) + ')</strong><p>' +
        esc(byMonth[mo].join(' and ')) + ' repaid. Your EMIs drop to ' + inr(obl) + ' a month. Safe loan: ' + inr(safe) + '.' +
        (isGoal ? ' <b>Your full ' + inr(m.ask) + ' fits from here.</b>' : '') + '</p></li>';
    });
    tl += '</ol>';
    html += tl;

    if (m.cons < MIN_CONS) {
      html += '<p class="roadmap-note">Also aim to earn in at least 20 of 26 weeks. Your EMIs may fit, but lenders also look at how regularly you earn.</p>';
    }
    el.innerHTML = html;
  }

  function renderDebt(m) {
    var el = $('debtBody');
    if (!m.loans.length) {
      el.innerHTML = '<p class="empty">You have no existing loans. Add one under "Your details" to see a payoff plan.</p>';
      return;
    }
    var plan = m.plan, base = m.base;
    var tiles = '<div class="tiles">';
    tiles += '<div class="tile"><span class="tile-num">' + (plan.months !== null ? plural(plan.months, 'month') : 'Not at this EMI') + '</span><span class="tile-label">Debt-free in' + (plan.months !== null ? ' (' + monthsFromNow(plan.months) + ')' : '') + '</span></div>';
    tiles += '<div class="tile"><span class="tile-num">' + inr(m.existing) + '</span><span class="tile-label">EMIs you pay each month</span></div>';
    tiles += '<div class="tile"><span class="tile-num">' + inr(plan.interest) + '</span><span class="tile-label">Interest still to pay</span></div>';
    if (m.extra > 0 && base.months !== null && plan.months !== null) {
      var saved = Math.max(0, base.interest - plan.interest), faster = Math.max(0, base.months - plan.months);
      tiles += '<div class="tile"><span class="tile-num">' + inr(saved) + '</span><span class="tile-label">Interest saved, and ' + plural(faster, 'month') + ' sooner</span></div>';
    }
    tiles += '</div>';

    var sorted = plan.loans.slice().sort(function (a, b) {
      if (a.clear === null && b.clear === null) return a.balance0 - b.balance0;
      if (a.clear === null) return 1;
      if (b.clear === null) return -1;
      return a.clear - b.clear || a.balance0 - b.balance0;
    });
    var list = '<ol class="debt-list">' + sorted.map(function (l, i) {
      var end;
      if (l.clear === null) end = '<strong>Not at this EMI</strong><span>EMI does not cover interest</span>';
      else if (l.clear === 0) end = '<strong>Cleared</strong><span>Nothing left</span>';
      else end = '<strong>Month ' + l.clear + '</strong><span>' + monthsFromNow(l.clear) + '</span>';
      return '<li class="debt-item"><span class="order">' + (i + 1) + '</span><div class="d-main"><strong>' + esc(l.name) + '</strong><span>' +
        inr(l.balance0) + ' left · ' + inr(l.emi) + ' a month · ' + (Math.round(l.rate * 10) / 10) + '% a year</span></div><div class="d-end">' + end + '</div></li>';
    }).join('') + '</ol>';

    el.innerHTML = tiles + list +
      '<p class="debt-note">We clear the smallest balance first, because it frees up EMI soonest and raises the loan you can safely take. Paying the highest interest first saves more interest. When you pay extra, freed-up EMIs roll into the next loan. Payoff amounts are estimates, so ask each lender for the exact closing amount.</p>';
  }

  function cmpPanel(cls, title, ev, ask, steps, tag) {
    return '<div class="cmp-panel ' + cls + '"><div class="cmp-head"><h5>' + title + '</h5><span class="pill ' + tag.cls + '">' + tag.text + '</span></div>' +
      '<span class="cmp-word lvl-' + ev.level + '">' + levelWord(ev.level) + '</span>' +
      '<dl class="cmp-rows">' +
        '<div><dt>Loan</dt><dd>' + inr(ask) + '</dd></div>' +
        '<div><dt>New EMI</dt><dd>' + inr(ev.newEmi) + '</dd></div>' +
        '<div><dt>EMIs vs lowest month</dt><dd>' + pct(ev.share) + '</dd></div>' +
        '<div><dt>Readiness score</dt><dd>' + clamp(ev.score, 0, 100) + ' / 100</dd></div>' +
      '</dl>' +
      '<ul class="cmp-steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';
  }

  function renderCompare(m) {
    var a = m.after;
    var nowSteps = [m.fitsNow ? 'Apply as things stand' : 'Apply as things stand and risk a no'];
    var afterTag = a.kind === 'none' ? { cls: 'pill-low', text: 'No change needed' } : { cls: 'pill-good', text: 'With the plan' };
    var html = '<div class="compare">' +
      cmpPanel('', 'Today', m.now, m.ask, nowSteps.map(esc), { cls: 'pill-low', text: 'As is' }) +
      '<span class="cmp-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>' +
      cmpPanel('after', 'After the plan', a.ev, a.loanAfter, a.steps.map(esc), afterTag) +
      '</div>';
    if (a.ev.level !== 'green' && a.ev.share <= LIMIT && m.min > 0) {
      html += '<p class="cmp-note">Because you earned in fewer than 20 of 26 weeks, the best result stays "Almost there" until your earning is steadier.</p>';
    }
    $('compareBody').innerHTML = html;
  }

  function renderStress(m) {
    var drop = clamp(num(m.s.drop), 0, 50);
    var sMin = m.min * (1 - drop / 100);
    var out = m.existing + m.now.newEmi;
    var sShare = sMin > 0 ? out / sMin : Infinity;
    var lvl = sShare <= LIMIT ? 'green' : sShare <= AMBER_LIMIT ? 'amber' : 'red';
    var left = sMin - out;
    var width = isFinite(sShare) ? Math.min(100, sShare * 100) : 100;
    var verdict = lvl === 'green' ? 'comfortable' : lvl === 'amber' ? 'tight, with little left for daily costs' : 'too much to pay safely';
    var stressSafe = floorTo((LIMIT * sMin - m.existing) / m.now.f, 500);

    var html = '<div class="stress-bar" role="img" aria-label="EMIs take ' + pct(sShare) + ' of your reduced lowest month"><span class="emi lvl-' + lvl + '" style="width:' + width + '%"></span></div>' +
      '<div class="stress-legend"><span>EMIs ' + inr(out) + ' (' + pct(sShare) + ')</span><span>' + (left >= 0 ? inr(left) + ' left for daily costs' : 'Short by ' + inr(-left)) + '</span></div>';
    if (m.min <= 0) {
      html += '<p class="stress-text">Add your monthly earnings to run the stress test.</p>';
    } else {
      html += '<p class="stress-text">If your earnings fall by ' + drop + '%, your lowest month becomes ' + inr(sMin) + '. EMIs of ' + inr(out) + ' would take ' + pct(sShare) + ' of it, which is ' + verdict + '.</p>';
      html += '<p class="stress-safe">' + (stressSafe >= m.ask ? 'Your loan stays comfortable even then.' : 'To stay comfortable even then, borrow up to ' + inr(stressSafe) + '.') + '</p>';
    }
    $('stressBody').innerHTML = html;
  }

  function renderCost(m) {
    var total = m.now.newEmi * m.tenure;
    var interest = Math.max(0, total - m.ask);
    var per100 = m.ask > 0 ? interest / m.ask * 100 : 0;
    var cls, msg;
    var base = 'For every ₹100 you borrow, you repay about ' + inr(100 + per100) + '. ';
    if (m.rate >= 36 || per100 >= 50) { cls = 'warn-red'; msg = 'Debt-trap warning. ' + base + 'Look for a cheaper loan or a shorter, smaller one.'; }
    else if (m.rate >= 26 || per100 >= 30) { cls = 'warn-amber'; msg = 'High cost. ' + base + 'Compare at least two lenders before you sign.'; }
    else { cls = 'warn-ok'; msg = 'Reasonable for this rate. ' + base + 'Still check the processing fee.'; }
    $('costBody').innerHTML = '<div class="tiles">' +
      '<div class="tile"><span class="tile-num">' + inr(m.now.newEmi) + '</span><span class="tile-label">EMI each month for ' + plural(m.tenure, 'month') + '</span></div>' +
      '<div class="tile"><span class="tile-num">' + inr(total) + '</span><span class="tile-label">Total you repay</span></div>' +
      '<div class="tile"><span class="tile-num">' + inr(interest) + '</span><span class="tile-label">Extra you pay as interest</span></div>' +
      '<div class="tile"><span class="tile-num">' + inr(per100) + '</span><span class="tile-label">Cost per ₹100 borrowed</span></div></div>' +
      '<p class="cost-warn ' + cls + '">' + msg + '</p>';
  }

  function renderPassport(m) {
    var maxM = Math.max.apply(null, m.months.concat([1]));
    var minIdx = m.months.indexOf(m.min);
    var bars = m.months.map(function (v, i) {
      return '<div class="bar' + (i === minIdx ? ' low' : '') + '"><span>' + kfmt(v) + '</span><i style="height:' + Math.max(2, v / maxM * 100) + '%"></i></div>';
    }).join('');
    var label = m.cons >= 0.85 ? 'Strong' : m.cons >= 0.7 ? 'Steady' : 'Irregular';
    $('passportBody').innerHTML = '<div class="passport">' +
      '<div class="pp-top"><h5>' + esc(m.s.name) + ' · ' + esc(m.s.role) + '</h5><span class="stamp">Self-reported, not verified</span></div>' +
      '<div><div class="bars" role="img" aria-label="Monthly earnings: ' + m.months.map(inr).join(', ') + '. The lowest month is shown in amber.">' + bars + '</div>' +
      '<div class="bar-months">' + MONTHS.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div></div>' +
      '<div class="pp-facts">' +
        '<div class="pp-fact"><b>' + inr(m.avg) + '</b><span>6-month average</span></div>' +
        '<div class="pp-fact"><b>' + inr(m.min) + '</b><span>Lowest month</span></div>' +
        '<div class="pp-fact"><b>' + m.weeks + ' of 26</b><span>Weeks earned</span></div>' +
        '<div class="pp-fact"><b>' + pct(m.cons) + ' ' + label + '</b><span>Consistency</span></div>' +
      '</div>' +
      '<p class="pp-note">In a full version, the platforms you earn on would confirm these numbers. A lender could then read this page instead of asking for payslips.</p></div>';
  }

  function updateOutputs() {
    $('weeksOut').textContent = clamp(Math.round(num(state.weeks)), 0, 26) + ' of 26 weeks';
    $('loanAmountOut').textContent = inr(num(state.loan));
    $('tenureOut').textContent = state.tenure + ' months';
    $('extraOut').textContent = num(state.extra) > 0 ? inr(num(state.extra)) + ' a month' : 'None';
    $('dropOut').textContent = clamp(num(state.drop), 0, 50) + '%';
  }

  function update() {
    var m = buildModel(state);
    updateOutputs();
    renderVerdict(m);
    renderDecoder(m);
    renderRoadmap(m);
    renderDebt(m);
    renderCompare(m);
    renderStress(m);
    renderCost(m);
    renderPassport(m);
    return m;
  }

  /* ---------- Inputs ---------- */
  function buildMonthFields() {
    var wrap = $('monthFields');
    MONTHS.forEach(function (mo, i) {
      var label = document.createElement('label');
      label.appendChild(document.createTextNode(mo));
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '500';
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('data-month', String(i));
      label.appendChild(input);
      wrap.appendChild(label);
    });
  }

  var TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function renderLoans() {
    var list = $('loansList');
    list.innerHTML = '';
    if (!state.loans.length) {
      var p = document.createElement('p');
      p.className = 'loans-empty';
      p.textContent = 'No loans yet. If you pay no EMIs, leave this empty.';
      list.appendChild(p);
    }
    state.loans.forEach(function (l) {
      var card = document.createElement('div');
      card.className = 'loan-card';
      card.setAttribute('data-id', String(l.id));
      card.innerHTML =
        '<div class="loan-top"><label>Loan name<input type="text" data-field="name" maxlength="30" placeholder="e.g. Phone loan"></label>' +
        '<button type="button" class="loan-remove" aria-label="Remove this loan">' + TRASH + '</button></div>' +
        '<div class="loan-fields">' +
          '<label>Balance left (₹)<input type="number" data-field="balance" min="0" step="500" inputmode="numeric"></label>' +
          '<label>EMI (₹/month)<input type="number" data-field="emi" min="0" step="100" inputmode="numeric"></label>' +
          '<label>Interest (% a year)<input type="number" data-field="rate" min="0" max="60" step="0.5" inputmode="decimal"></label>' +
        '</div>';
      card.querySelector('[data-field="name"]').value = l.name;
      card.querySelector('[data-field="balance"]').value = l.balance;
      card.querySelector('[data-field="emi"]').value = l.emi;
      card.querySelector('[data-field="rate"]').value = l.rate;
      list.appendChild(card);
    });
    $('addLoan').disabled = state.loans.length >= MAX_LOANS;
  }

  // Copy the state into every control (used after a person is loaded)
  function renderInputs() {
    state.months.forEach(function (v, i) {
      var el = document.querySelector('[data-month="' + i + '"]');
      if (el) el.value = v;
    });
    $('weeks').value = state.weeks;
    $('loanAmount').value = state.loan;
    $('tenure').value = state.tenure;
    $('rate').value = state.rate;
    $('extra').value = state.extra;
    $('drop').value = state.drop;
    $('who').textContent = state.name;
    $('whoRole').textContent = state.role;
    Array.prototype.forEach.call(document.querySelectorAll('#personChips .chip'), function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-person') === state.personKey));
    });
    renderLoans();
  }

  function loadPerson(key) {
    state = fromPerson(key);
    renderInputs();
    update();
  }

  function findLoan(id) {
    for (var i = 0; i < state.loans.length; i++) if (String(state.loans[i].id) === String(id)) return state.loans[i];
    return null;
  }

  function wireInputs() {
    $('monthFields').addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-month');
      if (i === null) return;
      state.months[+i] = num(e.target.value);
      update();
    });
    $('weeks').addEventListener('input', function (e) { state.weeks = +e.target.value; update(); });
    $('loanAmount').addEventListener('input', function (e) { state.loan = +e.target.value; update(); });
    $('tenure').addEventListener('input', function (e) { state.tenure = +e.target.value; update(); });
    $('rate').addEventListener('input', function (e) { state.rate = num(e.target.value); update(); });
    $('extra').addEventListener('input', function (e) { state.extra = +e.target.value; update(); });
    $('drop').addEventListener('input', function (e) { state.drop = +e.target.value; update(); });

    $('loansList').addEventListener('input', function (e) {
      var card = e.target.closest('.loan-card');
      var field = e.target.getAttribute('data-field');
      if (!card || !field) return;
      var loan = findLoan(card.getAttribute('data-id'));
      if (!loan) return;
      loan[field] = field === 'name' ? e.target.value : num(e.target.value);
      update();
    });
    $('loansList').addEventListener('click', function (e) {
      var btn = e.target.closest('.loan-remove');
      if (!btn) return;
      var card = btn.closest('.loan-card');
      var id = card.getAttribute('data-id');
      state.loans = state.loans.filter(function (l) { return String(l.id) !== String(id); });
      renderLoans();
      update();
    });
    $('addLoan').addEventListener('click', function () {
      if (state.loans.length >= MAX_LOANS) return;
      state.loans.push({ id: nextId++, name: '', balance: 10000, emi: 1000, rate: 18 });
      renderLoans();
      update();
      var inputs = document.querySelectorAll('#loansList [data-field="name"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    Array.prototype.forEach.call(document.querySelectorAll('#personChips .chip'), function (chip) {
      chip.addEventListener('click', function () { closeStory(); loadPerson(chip.getAttribute('data-person')); });
    });
    $('resetBtn').addEventListener('click', function () { closeStory(); loadPerson(state.personKey); });
  }

  /* ---------- Checklist ---------- */
  function buildChecklist() {
    var ul = $('checklist');
    CHECKLIST.forEach(function (it) {
      var li = document.createElement('li');
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', function () { checks[it.id] = input.checked; updateChecklist(); });
      var span = document.createElement('span');
      var strong = document.createElement('strong');
      strong.textContent = it.t;
      var small = document.createElement('small');
      small.textContent = it.d;
      span.appendChild(strong);
      span.appendChild(small);
      label.appendChild(input);
      label.appendChild(span);
      li.appendChild(label);
      ul.appendChild(li);
    });
    updateChecklist();
  }
  function updateChecklist() {
    var done = CHECKLIST.filter(function (it) { return checks[it.id]; }).length;
    $('checkBar').style.width = Math.round(done / CHECKLIST.length * 100) + '%';
    $('checkLabel').textContent = done + ' of ' + CHECKLIST.length + ' ready';
  }

  /* ---------- Story mode (a guided demo of Ravi) ---------- */
  var storyIndex = -1;
  var spotEl = null;

  var STORY = [
    { target: 'try', text: function (m) {
        return 'Meet Ravi, a delivery partner who earns about ' + inr(m.avg) + ' a month. He wants a ' + inr(m.ask) + ' loan over ' + m.tenure + ' months.';
    } },
    { target: 'res-verdict', text: function (m) {
        return 'Loan Coach says "' + levelWord(m.now.level) + '". His lowest month was ' + inr(m.min) + ', so his EMIs would take ' + pct(m.now.share) + ' of it. Lenders prefer under 40%. His safe loan is ' + inr(m.now.safeMax) + '.';
    } },
    { target: 'res-decoder', text: function () {
        return 'The Rejection Decoder lists the reasons a lender may give, ranked, with a fix beside each one.';
    } },
    { target: 'res-roadmap', text: function (m) {
        return m.opts.best
          ? 'The Approval Roadmap shows three ways forward. Paying off ' + m.opts.best.names.join(' and ') + ' (' + inr(m.opts.best.cost) + ') makes the full ' + inr(m.ask) + ' fit.'
          : 'The Approval Roadmap shows three ways forward: borrow less, pay off a loan, or wait.';
    } },
    { target: 'res-debt', act: function () { state.extra = 1500; renderInputs(); }, text: function (m) {
        return 'Ravi can pay ' + inr(1500) + ' extra a month. Loan Coach shows the order to clear his loans: he is debt-free in ' + (m.plan.months !== null ? plural(m.plan.months, 'month') : 'a while') + ', and the roadmap date moves closer.';
    } },
    { target: 'res-verdict', act: function () {
        state.extra = 0;
        state.loans = state.loans.filter(function (l) { return l.name !== 'Phone loan'; });
        renderInputs();
    }, text: function (m) {
        return 'Ravi pays off the phone loan. His EMIs now take ' + pct(m.now.share) + ' of his lowest month, and the result turns ' + levelWord(m.now.level) + '.';
    } },
    { target: 'res-stress', text: function (m) {
        var sMin = m.min * (1 - clamp(num(m.s.drop), 0, 50) / 100);
        return 'The stress test asks: what if his earnings drop ' + clamp(num(m.s.drop), 0, 50) + '%? His lowest month would be ' + inr(sMin) + ', so the loan is protected against a bad stretch before he signs.';
    } },
    { target: 'res-cost', text: function (m) {
        var per100 = m.ask > 0 ? Math.max(0, m.now.newEmi * m.tenure - m.ask) / m.ask * 100 : 0;
        return 'Last, the real cost: for every ' + '₹' + '100 he borrows, he repays about ' + inr(100 + per100) + '. Not just a no. A plan.';
    } }
  ];

  function clearSpot() {
    if (spotEl) { spotEl.classList.remove('spotlight'); spotEl = null; }
  }

  function showStory(i) {
    storyIndex = clamp(i, 0, STORY.length - 1);
    // Rebuild Ravi from scratch, then replay every step up to this one
    state = fromPerson('ravi');
    for (var j = 0; j <= storyIndex; j++) {
      if (STORY[j].act) STORY[j].act();
    }
    renderInputs();
    var m = update();
    var step = STORY[storyIndex];
    $('storyStep').textContent = 'Step ' + (storyIndex + 1) + ' of ' + STORY.length;
    $('storyText').textContent = step.text(m);
    $('storyPrev').disabled = storyIndex === 0;
    $('storyNext').textContent = storyIndex === STORY.length - 1 ? 'Finish' : 'Next';
    clearSpot();
    var target = $(step.target);
    if (target) {
      if (target.classList.contains('res')) { target.classList.add('spotlight'); spotEl = target; }
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function openStory() {
    $('storyBar').hidden = false;
    document.body.classList.add('story-on');
    showStory(0);
  }
  function closeStory() {
    if ($('storyBar').hidden) return;
    $('storyBar').hidden = true;
    document.body.classList.remove('story-on');
    clearSpot();
    storyIndex = -1;
  }

  function wireStory() {
    $('storyBtn').addEventListener('click', openStory);
    $('storyNext').addEventListener('click', function () {
      if (storyIndex >= STORY.length - 1) closeStory(); else showStory(storyIndex + 1);
    });
    $('storyPrev').addEventListener('click', function () { showStory(storyIndex - 1); });
    $('storyClose').addEventListener('click', closeStory);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeStory();
    });
  }

  /* ---------- Navigation ---------- */
  function wireNav() {
    var toggle = $('navToggle'), nav = $('mainNav');
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Start ---------- */
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.brand-name'), function (el) { el.textContent = BRAND; });
    $('year').textContent = String(new Date().getFullYear());
    buildMonthFields();
    buildChecklist();
    wireInputs();
    wireStory();
    wireNav();
    renderHero();
    renderInputs();
    update();
  }

  // Handy for testing in the browser console
  window.LoanCoachDebug = {
    get state() { return state; },
    fromPerson: fromPerson, buildModel: buildModel, evaluate: evaluate, simulate: simulate, update: update
  };

  init();
})();
