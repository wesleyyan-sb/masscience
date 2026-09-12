/**
 * Masscience — Main application
 */
import {
  loadState, saveState, exportData, exportCycleReport, importData, resetData,
  saveAutoBackup, getLatestBackup, restoreLatestBackup, clearAutoBackups,
  getDataHealthSummary,
} from './js/storage.js';
import { ALGORITHM_VERSION, APP_VERSION, PHASE, STATUS, CYCLE } from './js/constants.js';
import {
  buildInitialPlan, calculateMacros, calculateWaterTarget,
  recommendedGainRange, validateProfile, portionGuide, compositionFromBF, compositionRange, calculateFFMI,
} from './js/calculations.js';
import { estimateBodyComposition } from './js/composition.js';
import { processWeightData, getTargetTrajectory } from './js/trend.js';
import {
  estimateAdaptiveTDEE, calculateConsistencyScore,
  checkSafetyLimits, calculateTrajectoryRisk,
} from './js/adaptive.js';
import { calculateCalorieAdjustment } from './js/control.js';
import { calculateTrajectoryError } from './js/trajectory.js';
import { formatConfidenceLabel } from './js/confidence.js';
import {
  createCycle, advanceCyclePhase, addWeightMeasurement, updateWeighInFrequency,
  getCycleTimeline, getReminders,
  getNextWeighInDate, pauseCycle, resumeCycle, resetCycle, shouldWeighToday,
} from './js/cycle.js';
import { projectCycleEnd, projectFullCycle, generateScenarios, getPhaseProgress, getCalibrationProgress } from './js/projection.js';
import { renderWeightChart, renderBFChart, renderCalorieChart, renderProjectionChart } from './js/charts.js';
import { loadDemoData } from './js/demo.js';
import {
  formatWeight, formatHeight, formatCalories, formatLiters, escapeHtml,
  today, daysBetween, round, uuid,
} from './js/utils.js';
import { t, setLanguage, getLanguage, SUPPORTED_LANGUAGES } from './js/i18n.js';

class MasscienceApp {
  constructor() {
    this.state = loadState();
    this.currentPage = 'dashboard';
    this.activeEvolutionTab = 'progress';
    this.activeStrategyTab = 'cycle';
    this.activeMoreTab = 'history';
    this.onboardingStep = 0;
    this.computed = {};
    this.init();
  }

  init() {
    const lang = this.state.settings?.language || 'en';
    setLanguage(lang);
    this.applyTheme();
    this.bindGlobalEvents();
    if (!this.state.onboarded) {
      this.showLanding();
    } else {
      this.recompute();
      this.render();
    }
  }

  recompute() {
    const currentState = this.state;
    if (!currentState.profile || !currentState.currentCycle) return;

    this.state = advanceCyclePhase(currentState, currentState.settings);
    const state = this.state;
    const startDate = state.currentCycle.startDate;
    const phaseStartDate = state.currentCycle.phaseStartDate || startDate;
    const trendData = processWeightData(state.weightMeasurements, startDate, { phaseStartDate });

    const phase = state.currentCycle.phase;
    const currentWeight = trendData.latest?.trend || state.profile.weightKg;
    const gainRange = recommendedGainRange({ ...state.profile, currentPhase: phase }, phase, currentWeight);

    trendData.weeksSinceStart = daysBetween(startDate, today()) / 7;
    trendData.totalGain = trendData.latest
      ? trendData.latest.trend - state.currentCycle.initialWeight
      : 0;

    const phaseProgress = getPhaseProgress(state.currentCycle);
    state.algorithmState.currentPhase = phase;
    state.algorithmState.daysInPhase = phaseProgress.dayInPhase;

    const compResult = estimateBodyComposition(
      state.profile, trendData, state.bodyMeasurements, state.algorithmState
    );
    const bfEstimate = compResult.bf;
    const currentCalories = state.algorithmState.currentCalories;
    const tdeeResult = estimateAdaptiveTDEE(state, trendData, currentCalories);

    trendData.phaseDaysRemaining = phaseProgress.remainingWeeks * 7;

    const trajectoryError = calculateTrajectoryError(
      trendData, state.currentCycle.initialWeight, gainRange.target, startDate
    );

    const projection = projectCycleEnd(state, trendData, bfEstimate, gainRange, state.settings);
    const risk = calculateTrajectoryRisk(projection, state.currentCycle.maxBf, bfEstimate, trendData.confidence);
    const calorieAdj = calculateCalorieAdjustment(
      state, trendData, gainRange, phase, trajectoryError
    );
    const fullProjection = projectFullCycle(state, trendData, bfEstimate, state.settings);
    const compRange = compResult.composition ?? compositionRange(currentWeight, bfEstimate);
    const macros = calculateMacros(currentCalories, state.profile.weightKg);
    const water = calculateWaterTarget(state.profile.weightKg, state.profile.trainingSessions, state.profile.activityLevel);
    const consistency = calculateConsistencyScore(state, trendData);
    const safety = checkSafetyLimits(currentCalories, phase, state.profile);
    const trajectory = getTargetTrajectory(
      state.currentCycle.initialWeight, 0, gainRange.target,
      daysBetween(startDate, today()) + 14
    );

    state.algorithmState.estimatedTDEE = tdeeResult.estimate;
    state.algorithmState.tdeeConfidence = tdeeResult.confidence;
    state.algorithmState.tdeeRange = { low: tdeeResult.low, high: tdeeResult.high };
    state.algorithmState.consistencyScore = consistency;
    state.algorithmState.smoothedBf = bfEstimate.smoothedBfForStorage ?? bfEstimate.estimate;
    if (compResult._state) {
      if (compResult._state.recentWeightDirection != null) {
        state.algorithmState.recentWeightDirection = compResult._state.recentWeightDirection;
      }
      if (compResult._state.bfTargetHistory != null) {
        state.algorithmState.bfTargetHistory = compResult._state.bfTargetHistory;
      }
      if (compResult._state.estimatedFatMassKg != null) {
        state.algorithmState.estimatedFatMassKg = compResult._state.estimatedFatMassKg;
      }
      if (compResult._state.prevTrendWeightForBf != null) {
        state.algorithmState.prevTrendWeightForBf = compResult._state.prevTrendWeightForBf;
      }
      if (compResult._state.bfLastEnergyDate != null) {
        state.algorithmState.bfLastEnergyDate = compResult._state.bfLastEnergyDate;
      }
    }
    state.algorithmVersion = ALGORITHM_VERSION;

    this.computed = {
      trendData, gainRange, bfEstimate, calorieAdj, projection, risk,
      trajectoryError, tdeeResult, compRange,
      fullProjection, macros, water, consistency, safety, trajectory,
      phaseProgress,
      calibration: getCalibrationProgress(state.currentCycle),
      reminders: getReminders(state),
      nextWeighIn: getNextWeighInDate(state),
      timeline: getCycleTimeline(state.currentCycle, state.settings),
      scenarios: generateScenarios(state.profile, state.settings),
      controllerState: {
        rateError: calorieAdj.rateError,
        trajectoryErrorKg: calorieAdj.trajectoryErrorKg,
        confidenceWeight: calorieAdj.confidenceWeight,
        inCooldown: calorieAdj.inCooldown,
      },
    };

    this.state = updateWeighInFrequency(state, trendData);
    saveState(this.state);
    this.maybeNotify();
  }

  maybeNotify() {
    if (!this.state.settings.notifications || !this.state.onboarded) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const key = `masscience_notified_${today()}`;
    if (localStorage.getItem(key)) return;

    const reminders = this.computed.reminders || [];
    const weighIn = reminders.find(r => r.type === 'weigh-in');
    if (weighIn) {
      localStorage.setItem(key, '1');
      new Notification('Masscience', { body: weighIn.text, tag: 'weigh-in' });
    }
  }

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        this.state.settings.notifications = p === 'granted';
        saveState(this.state);
        this.render();
      });
    }
  }

  applyTheme() {
    const theme = this.state.settings?.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme);
  }

  bindGlobalEvents() {
    document.getElementById('app').addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); this.navigate(nav.dataset.nav); return; }

      const subnav = e.target.closest('[data-subnav]');
      if (subnav) {
        e.preventDefault();
        const tab = subnav.dataset.subnav;
        if (['progress', 'body'].includes(tab)) {
          this.activeEvolutionTab = tab;
          this.currentPage = 'evolution';
        } else if (['cycle', 'nutrition'].includes(tab)) {
          this.activeStrategyTab = tab;
          this.currentPage = 'strategy';
        } else if (['history', 'future', 'settings', 'about'].includes(tab)) {
          this.activeMoreTab = tab;
          this.currentPage = 'more';
        }
        this.render();
        return;
      }

      const action = e.target.closest('[data-action]');
      if (action) this.handleAction(action.dataset.action, action);

      if (e.target.id === 'modal-overlay') this.closeModal();
    });

    document.getElementById('app').addEventListener('change', (e) => {
      if (e.target.id === 'onboarding-language-select') {
        const lang = e.target.value;
        this.onboardingData.language = lang;
        setLanguage(lang);
        this.renderOnboarding();
        return;
      }

      const chipCheckbox = e.target.closest('.context-tag-chip input[type="checkbox"]');
      if (chipCheckbox) {
        chipCheckbox.closest('.context-tag-chip')?.classList.toggle('selected', chipCheckbox.checked);
      }

      const radio = e.target.closest('input[type="radio"]');
      if (radio) {
        const name = radio.name;
        const form = radio.form || document.getElementById('onboarding-form');
        if (form) {
          form.querySelectorAll(`input[name="${name}"]`).forEach(inp => {
            const card = inp.closest('.radio-card, .session-chip');
            if (card) card.classList.toggle('selected', inp.checked);
          });
          if (this.onboardingData && typeof this.onboardingData === 'object') {
            this.onboardingData[name] = radio.value;
          }
        }
      }
    });

    document.getElementById('app').addEventListener('input', (e) => {
      if (e.target.id === 'custom-sessions-input') {
        const val = e.target.value.trim();
        if (val) {
          this.onboardingData.trainingSessions = val;
          const form = document.getElementById('onboarding-form');
          if (form) {
            form.querySelectorAll('input[name="trainingSessions"]').forEach(inp => {
              inp.checked = false;
              const card = inp.closest('.session-chip');
              if (card) card.classList.remove('selected');
            });
          }
        }
      }
    });

    document.getElementById('app').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      if (form.id === 'weigh-in-form') this.handleWeighIn(form);
      if (form.id === 'body-check-form') this.handleBodyCheck(form);
      if (form.id === 'onboarding-form') this.handleOnboardingSubmit(form);
    });
  }

  navigate(page) {
    if (['progress', 'body'].includes(page)) {
      this.currentPage = 'evolution';
      this.activeEvolutionTab = page;
    } else if (['cycle', 'nutrition'].includes(page)) {
      this.currentPage = 'strategy';
      this.activeStrategyTab = page;
    } else if (['history', 'future', 'settings', 'about', 'learn'].includes(page)) {
      this.currentPage = 'more';
      this.activeMoreTab = (page === 'learn' ? 'about' : page);
    } else {
      this.currentPage = page;
    }
    this.render();
    window.scrollTo(0, 0);
  }

  handleAction(action, el) {
    switch (action) {
      case 'start': this.showOnboarding(); break;
      case 'demo': this.state = loadDemoData(); this.recompute(); this.render(); break;
      case 'onboarding-next': this.onboardingNext(); break;
      case 'onboarding-back': this.onboardingStep = Math.max(0, this.onboardingStep - 1); this.renderOnboarding(); break;
      case 'start-calibration': this.startCycle(); break;
      case 'pause-cycle': this.state = pauseCycle(this.state); saveState(this.state); this.render(); break;
      case 'resume-cycle': this.state = resumeCycle(this.state); saveState(this.state); this.render(); break;
      case 'reset-cycle': if (confirm('Reset current cycle? Weight data will be cleared.')) {
        this.state = resetCycle(this.state, this.state.settings); saveState(this.state); this.recompute(); this.render();
      } break;
      case 'apply-calories': this.applyCalorieAdjustment(); break;
      case 'export': exportData(this.state); break;
      case 'export-report': exportCycleReport(this.state, this.computed); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'backup-now':
        saveAutoBackup(this.state);
        alert('Local backup created successfully.');
        this.render();
        break;
      case 'restore-backup':
        try {
          const backup = restoreLatestBackup();
          this.state = backup;
          saveState(this.state);
          this.recompute();
          this.render();
          alert('Latest backup restored.');
        } catch (err) {
          alert(err.message || 'No backup available to restore.');
        }
        break;
      case 'clear-backups':
        clearAutoBackups();
        alert('Saved backups cleared.');
        this.render();
        break;
      case 'reset-all': if (confirm('Delete ALL data? This cannot be undone.')) {
        this.state = resetData(); this.showLanding();
      } break;
      case 'toggle-portions': this.state.settings.showPortionGuide = !this.state.settings.showPortionGuide;
        saveState(this.state); this.render(); break;
      case 'update-bf': this.showBfUpdateModal(); break;
      case 'close-modal': this.closeModal(); break;
      case 'save-bf': this.saveBfUpdate(); break;
      case 'clear-demo': if (confirm('Clear demo data and start fresh?')) {
        this.state = resetData(); this.showLanding();
      } break;
    }
  }

  showLanding() {
    document.getElementById('app').innerHTML = `
      <div class="landing">
        <div class="landing-content">
          <h1 class="logo">${t('appName')}</h1>
          <p class="tagline">${t('tagline')}</p>
          <p class="subtitle">${t('taglineSubtitle')}</p>
          <button class="btn btn-primary btn-lg" data-action="start">${t('btnStart')}</button>
          <button class="btn btn-secondary" data-action="demo">${t('btnDemo')}</button>
        </div>
      </div>`;
  }

  showOnboarding() {
    this.onboardingStep = 0;
    this.onboardingData = { units: 'metric', language: getLanguage() || 'en' };
    this.renderOnboarding();
  }

  renderOnboarding() {
    const steps = [
      t('onboarding_step_0'),
      t('onboarding_step_1'),
      t('onboarding_step_2'),
      t('onboarding_step_3'),
      t('onboarding_step_4'),
      t('onboarding_step_5'),
    ];
    const step = this.onboardingStep;
    const d = this.onboardingData;

    let content = '';
    if (step === 0) {
      const curLang = d.language || getLanguage() || 'en';
      content = `
        <div class="form-group"><label>${t('onboarding_language')}</label>
          <select name="language" id="onboarding-language-select">
            ${SUPPORTED_LANGUAGES.map(l => `<option value="${l.id}" ${curLang === l.id ? 'selected' : ''}>${l.flag} ${l.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>${t('onboarding_age')}</label><input type="number" name="age" value="${d.age || ''}" min="16" max="80" required></div>
        <div class="form-group"><label>${t('onboarding_sex')}</label>
          <select name="sex" required><option value="">Select</option>
            <option value="male" ${d.sex === 'male' ? 'selected' : ''}>${t('onboarding_male')}</option>
            <option value="female" ${d.sex === 'female' ? 'selected' : ''}>${t('onboarding_female')}</option>
          </select></div>
        <div class="form-group"><label>${t('onboarding_units')}</label>
          <select name="units"><option value="metric" ${d.units === 'metric' ? 'selected' : ''}>${t('onboarding_metric')}</option>
            <option value="imperial" ${d.units === 'imperial' ? 'selected' : ''}>${t('onboarding_imperial')}</option></select></div>`;
    } else if (step === 1) {
      const isImp = d.units === 'imperial';
      content = `
        <div class="form-group"><label>${t('onboarding_height')} ${isImp ? '(in)' : '(cm)'}</label>
          <input type="number" name="height" value="${d.height || ''}" required step="0.1"></div>
        <div class="form-group"><label>${t('onboarding_current_weight')} ${isImp ? '(lb)' : '(kg)'}</label>
          <input type="number" name="weight" value="${d.weight || ''}" required step="0.1"></div>
        <div class="form-group"><label>${t('onboarding_bf_estimate')}</label>
          <input type="number" name="bodyFat" value="${d.bodyFat || ''}" min="3" max="50" step="0.1" required>
          <span class="hint">${t('onboarding_bf_hint')}</span></div>`;
    } else if (step === 2) {
      const currentSessions = d.trainingSessions ? parseInt(d.trainingSessions) : 4;
      content = `
        <div class="form-group"><label>${t('onboarding_training_years')}</label>
          <input type="number" name="trainingYears" value="${d.trainingYears || ''}" min="0" max="40" step="0.5" placeholder="e.g. 3" required></div>
        <div class="form-group">
          <label>${t('onboarding_sessions_week')}</label>
          <div class="sessions-selector-grid">
            ${[2, 3, 4, 5, 6].map(num => `
              <label class="session-chip ${currentSessions === num ? 'selected' : ''}">
                <input type="radio" name="trainingSessions" value="${num}" ${currentSessions === num ? 'checked' : ''}>
                <strong>${num}x</strong>
                <span>/ week</span>
              </label>
            `).join('')}
          </div>
          <div class="custom-sessions-wrapper" style="margin-top: 0.6rem;">
            <span class="hint">${t('onboarding_custom_sessions')}</span>
            <input type="number" id="custom-sessions-input" min="1" max="14" placeholder="Other (e.g. 7)" value="${![2, 3, 4, 5, 6].includes(currentSessions) && d.trainingSessions ? d.trainingSessions : ''}" style="width: 120px; display: inline-block; margin-left: 0.5rem; padding: 0.4rem 0.6rem; font-size: 0.85rem;">
          </div>
        </div>`;
    } else if (step === 3) {
      const levels = [
        ['sedentary', t('onboarding_sedentary'), t('onboarding_sedentary_desc')],
        ['lightly_active', t('onboarding_light'), t('onboarding_light_desc')],
        ['moderately_active', t('onboarding_moderate'), t('onboarding_moderate_desc')],
        ['very_active', t('onboarding_very'), t('onboarding_very_desc')],
        ['extremely_active', t('onboarding_extreme'), t('onboarding_extreme_desc')],
      ];
      content = levels.map(([val, title, desc]) => `
        <label class="radio-card ${d.activityLevel === val ? 'selected' : ''}">
          <input type="radio" name="activityLevel" value="${val}" ${d.activityLevel === val ? 'checked' : ''}>
          <div class="radio-indicator"></div>
          <div class="radio-content">
            <strong class="radio-title">${title}</strong>
            <span class="radio-desc">${desc}</span>
          </div>
        </label>`).join('');
    } else if (step === 4) {
      content = `<p class="info-text">Masscience uses a 10-week lean bulk followed by a 3-week minicut. The adaptive engine adjusts calories based on your weight trend — not food logging.</p>
        <p class="info-text emphasis">You don't need to weigh every meal.</p>`;
    } else if (step === 5) {
      const profile = this.buildProfileFromOnboarding();
      const plan = buildInitialPlan(profile, { bulkWeeks: 10, minicutWeeks: 3 });
      content = `
        <div class="plan-summary">
          <h3>${t('onboarding_plan_summary')}</h3>
          <div class="plan-grid">
            <div class="plan-item"><span class="plan-label">Lean Bulk</span><span class="plan-value">10 weeks</span></div>
            <div class="plan-item"><span class="plan-label">Minicut</span><span class="plan-value">3 weeks</span></div>
            <div class="plan-item"><span class="plan-label">${t('onboarding_starting_cals')}</span><span class="plan-value">${formatCalories(plan.bulkCalories)}</span></div>
            <div class="plan-item"><span class="plan-label">Target gain</span><span class="plan-value">~${plan.gainRange.targetPercent}% BW/wk (${plan.gainRange.min}–${plan.gainRange.max} kg/wk)</span></div>
            <div class="plan-item"><span class="plan-label">Max projected BF</span><span class="plan-value">~${plan.maxBf}%</span></div>
            <div class="plan-item"><span class="plan-label">${t('protein_label')}</span><span class="plan-value">${plan.macros.protein} g</span></div>
            <div class="plan-item"><span class="plan-label">${t('onboarding_est_tdee')}</span><span class="plan-value">${formatCalories(plan.tdee)}</span></div>
            <div class="plan-item"><span class="plan-label">Est. FFMI</span><span class="plan-value">${plan.ffmi}</span></div>
          </div>
          <p class="hint">All body-composition values are estimates.</p>
        </div>`;
    }

    document.getElementById('app').innerHTML = `
      <div class="onboarding">
        <div class="onboarding-header">
          <span class="step-indicator">${step + 1} / ${steps.length}</span>
          <h2>${steps[step]}</h2>
          <div class="progress-bar"><div class="progress-fill" style="width:${((step + 1) / steps.length) * 100}%"></div></div>
        </div>
        <form id="onboarding-form" class="onboarding-form">${content}</form>
        <div class="onboarding-actions">
          ${step > 0 ? `<button type="button" class="btn btn-ghost" data-action="onboarding-back">${t('btnBack')}</button>` : '<span></span>'}
          ${step < steps.length - 1
            ? `<button type="button" class="btn btn-primary" data-action="onboarding-next">${t('btnNext')}</button>`
            : `<button type="button" class="btn btn-primary btn-lg" data-action="start-calibration">${t('onboarding_start_calibration')}</button>`}
        </div>
      </div>`;
  }

  onboardingNext() {
    const form = document.getElementById('onboarding-form');
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) this.onboardingData[k] = v;

    const customSessions = document.getElementById('custom-sessions-input');
    if (customSessions && customSessions.value.trim()) {
      this.onboardingData.trainingSessions = customSessions.value.trim();
    }

    if (this.onboardingStep === 0 && (!this.onboardingData.age || !this.onboardingData.sex)) {
      alert('Please enter your age and sex.'); return;
    }
    if (this.onboardingStep === 1 && (!this.onboardingData.height || !this.onboardingData.weight || !this.onboardingData.bodyFat)) {
      alert('Please complete all body measurements.'); return;
    }
    if (this.onboardingStep === 2 && (!this.onboardingData.trainingYears || !this.onboardingData.trainingSessions)) {
      alert('Please enter your training details.'); return;
    }
    if (this.onboardingStep === 3 && !this.onboardingData.activityLevel) {
      alert('Please select your activity level.'); return;
    }

    this.onboardingStep++;
    this.renderOnboarding();
  }

  buildProfileFromOnboarding() {
    const d = this.onboardingData;
    let heightCm = parseFloat(d.height);
    let weightKg = parseFloat(d.weight);
    if (d.units === 'imperial') {
      heightCm = d.height * 2.54;
      weightKg = d.weight / 2.20462;
    }
    return {
      age: parseInt(d.age),
      sex: d.sex,
      heightCm,
      weightKg,
      bodyFatPercent: parseFloat(d.bodyFat),
      trainingYears: parseFloat(d.trainingYears),
      trainingSessions: parseInt(d.trainingSessions),
      activityLevel: d.activityLevel,
    };
  }

  startCycle() {
    const profile = this.buildProfileFromOnboarding();
    const errors = validateProfile(profile);
    if (errors.length) { alert(errors.join('\n')); this.onboardingStep = 1; this.renderOnboarding(); return; }

    const chosenLang = this.onboardingData.language || this.state.settings?.language || 'en';
    const settings = {
      ...this.state.settings,
      units: this.onboardingData.units || 'metric',
      language: chosenLang,
    };
    setLanguage(chosenLang);
    const plan = buildInitialPlan(profile, settings);
    const cycle = createCycle(profile, settings, plan);

    this.state = {
      ...this.state,
      onboarded: true,
      profile,
      settings,
      currentCycle: cycle,
      weightMeasurements: [],
      bodyMeasurements: [],
      calorieHistory: [],
      algorithmState: {
        estimatedTDEE: plan.tdee,
        tdeeConfidence: 30,
        currentCalories: plan.bulkCalories,
        weighInFrequency: 'daily',
        frequencyPhaseStart: today(),
        lastCalorieAdjustment: null,
        consistencyScore: 0,
      },
    };
    saveState(this.state);
    this.recompute();
    this.render();
  }

  handleWeighIn(form) {
    const weight = parseFloat(form.weight.value);
    const units = this.state.settings.units;
    const weightKg = units === 'imperial' ? weight / 2.20462 : weight;

    if (!weightKg || weightKg < 30 || weightKg > 300) {
      alert('Please enter a valid weight.');
      return;
    }

    const isSodiumSpike = form.isSodiumSpike ? form.isSodiumSpike.checked : false;
    const heavyLegDay = form.heavyLegDay ? form.heavyLegDay.checked : false;
    const creatineLoading = form.creatineLoading ? form.creatineLoading.checked : false;
    const hormonalCycleStart = form.hormonalCycleStart ? form.hormonalCycleStart.checked : false;
    const poorSleepStress = form.poorSleepStress ? form.poorSleepStress.checked : false;

    this.state = addWeightMeasurement(this.state, weightKg, {
      isSodiumSpike,
      heavyLegDay,
      creatineLoading,
      hormonalCycleStart,
      poorSleepStress,
    });
    saveState(this.state);
    this.recompute();
    this.render();
  }

  handleBodyCheck(form) {
    const fd = new FormData(form);
    const entry = { date: today(), id: uuid() };
    for (const [k, v] of fd.entries()) {
      if (v && k !== 'photo' && k !== 'method') entry[k] = parseFloat(v);
      else if (v && k === 'method') entry[k] = v;
    }
    if (entry.chestFold || entry.abdomenFold || entry.thighFold || entry.triceps || entry.suprailiac) {
      entry.folds = {
        chest: entry.chestFold,
        abdomen: entry.abdomenFold,
        thigh: entry.thighFold,
        triceps: entry.triceps,
        suprailiac: entry.suprailiac,
      };
    }
    const photoInput = form.querySelector('#body-photo-input');
    if (photoInput?.files?.[0]) {
      const file = photoInput.files[0];
      if (file.size > 2 * 1024 * 1024) {
        alert('Photo must be under 2 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        entry.photo = e.target.result;
        this.state.bodyMeasurements.push(entry);
        saveState(this.state);
        this.recompute();
        this.render();
      };
      reader.readAsDataURL(file);
      return;
    }
    this.state.bodyMeasurements.push(entry);
    saveState(this.state);
    this.recompute();
    this.render();
  }

  applyCalorieAdjustment() {
    const adj = this.computed.calorieAdj;
    if (!adj.shouldAdjust) return;
    const previous = this.state.algorithmState.currentCalories;
    this.state.algorithmState.currentCalories = adj.recommendedCalories;
    this.state.algorithmState.lastCalorieAdjustment = today();
    this.state.calorieHistory.push({
      date: today(),
      previous,
      new: adj.recommendedCalories,
      adjustment: adj.adjustment,
      reason: adj.message,
      status: adj.status,
    });
    saveState(this.state);
    this.recompute();
    this.render();
  }

  showBfUpdateModal() {
    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById('modal-content').innerHTML = `
      <h3>Atualizar Estimativa de Gordura (%BF)</h3>
      <p class="hint">Insira um valor aferido por DEXA, adipômetro ou exame clínico para calibrar a precisão.</p>
      <div class="form-grid">
        <div class="form-group"><label>Body fat (%)</label>
          <input type="number" id="bf-input" value="${this.state.profile.bodyFatPercent}" min="3" max="50" step="0.1"></div>
        <div class="form-group"><label>Método de Medição</label>
          <select id="bf-method-input">
            <option value="direct">DEXA / Exame Clínico (Mais preciso)</option>
            <option value="caliper">Adipômetro / Dobras</option>
            <option value="bia">Balança de Bioimpedância</option>
            <option value="manual">Manual / Estimativa Visual</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
        <button class="btn btn-primary" data-action="save-bf">Salvar e Calibrar</button>
      </div>`;
  }

  saveBfUpdate() {
    const val = parseFloat(document.getElementById('bf-input').value);
    const method = document.getElementById('bf-method-input')?.value || 'direct';
    if (val >= 3 && val <= 50) {
      this.state.profile.bodyFatPercent = val;
      if (this.state.algorithmState) {
        this.state.algorithmState.smoothedBf = val;
        const currentWeight = this.computed?.trendData?.latest?.trend || this.state.profile.weightKg;
        this.state.algorithmState.estimatedFatMassKg = Number(((val / 100) * currentWeight).toFixed(4));
        this.state.algorithmState.bfTargetHistory = [val];
      }
      this.state.bodyMeasurements.push({
        date: today(),
        id: uuid(),
        bodyFatPercent: val,
        method,
      });
      saveState(this.state);
      this.recompute();
    }
    this.closeModal();
    this.render();
  }

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  statusBadge(status) {
    const map = {
      green: { icon: '🟢', label: 'ON TRACK', class: 'status-green' },
      yellow: { icon: '🟡', label: 'ADJUSTMENT', class: 'status-yellow' },
      red: { icon: '🔴', label: 'OFF TRACK', class: 'status-red' },
      neutral: { icon: '🔵', label: 'LEARNING', class: 'status-neutral' },
    };
    const s = map[status] || map.neutral;
    return `<div class="status-badge ${s.class}"><span>${s.icon}</span> ${s.label}</div>`;
  }

  getActiveTabId() {
    if (this.currentPage === 'dashboard') return 'dashboard';
    if (['evolution', 'progress', 'body'].includes(this.currentPage)) return 'evolution';
    if (['strategy', 'cycle', 'nutrition'].includes(this.currentPage)) return 'strategy';
    return 'more';
  }

  renderEvolutionPage(forceTab) {
    if (forceTab) this.activeEvolutionTab = forceTab;
    const tab = this.activeEvolutionTab;
    return `
      <div class="segmented-nav">
        <button class="segmented-btn ${tab === 'progress' ? 'active' : ''}" data-subnav="progress">${t('tab_progress')}</button>
        <button class="segmented-btn ${tab === 'body' ? 'active' : ''}" data-subnav="body">${t('tab_body')}</button>
      </div>
      ${tab === 'body' ? this.renderBodyPage() : this.renderProgress()}`;
  }

  renderStrategyPage(forceTab) {
    if (forceTab) this.activeStrategyTab = forceTab;
    const tab = this.activeStrategyTab;
    return `
      <div class="segmented-nav">
        <button class="segmented-btn ${tab === 'cycle' ? 'active' : ''}" data-subnav="cycle">${t('tab_cycle')}</button>
        <button class="segmented-btn ${tab === 'nutrition' ? 'active' : ''}" data-subnav="nutrition">${t('tab_nutrition')}</button>
      </div>
      ${tab === 'nutrition' ? this.renderNutritionPage() : this.renderCyclePage()}`;
  }

  renderMorePage(forceTab) {
    if (forceTab) this.activeMoreTab = forceTab;
    const tab = this.activeMoreTab;
    return `
      <div class="segmented-nav">
        <button class="segmented-btn ${tab === 'history' ? 'active' : ''}" data-subnav="history">${t('tab_history')}</button>
        <button class="segmented-btn ${tab === 'future' ? 'active' : ''}" data-subnav="future">${t('tab_future')}</button>
        <button class="segmented-btn ${tab === 'settings' ? 'active' : ''}" data-subnav="settings">${t('tab_settings')}</button>
        <button class="segmented-btn ${tab === 'about' ? 'active' : ''}" data-subnav="about">${t('tab_about')}</button>
      </div>
      ${tab === 'future' ? this.renderFuturePage() : (tab === 'settings' ? this.renderSettingsPage() : (tab === 'about' ? this.renderAboutPage() : this.renderHistoryPage()))}`;
  }

  render() {
    if (!this.state.onboarded) return;

    const pages = {
      dashboard: () => this.renderDashboard(),
      evolution: () => this.renderEvolutionPage(),
      strategy: () => this.renderStrategyPage(),
      more: () => this.renderMorePage(),
      progress: () => this.renderEvolutionPage('progress'),
      body: () => this.renderEvolutionPage('body'),
      cycle: () => this.renderStrategyPage('cycle'),
      nutrition: () => this.renderStrategyPage('nutrition'),
      future: () => this.renderMorePage('future'),
      history: () => this.renderMorePage('history'),
      settings: () => this.renderMorePage('settings'),
      about: () => this.renderMorePage('about'),
      learn: () => this.renderMorePage('about'),
    };

    const activeTab = this.getActiveTabId();

    const navItems = [
      ['dashboard', t('nav_today'), '⌂'],
      ['evolution', t('nav_evolution'), '📈'],
      ['strategy', t('nav_strategy'), '🔄'],
      ['more', t('nav_more'), '⚙'],
    ];

    document.getElementById('app').innerHTML = `
      <div class="app-shell">
        <header class="app-header">
          <h1 class="logo-sm">MASSCIENCE</h1>
          ${this.renderReminders()}
        </header>
        <main class="app-main" id="main-content">${(pages[this.currentPage] || pages.dashboard)()}</main>
        <nav class="bottom-nav" aria-label="Main navigation">
          ${navItems.map(([id, label, icon]) => `
            <a href="#" data-nav="${id}" class="nav-item ${activeTab === id ? 'active' : ''}" aria-label="${label}">
              <span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>
            </a>`).join('')}
        </nav>
      </div>
      <div id="modal-overlay" class="modal-overlay"><div id="modal-content" class="modal"></div></div>`;

    this.renderCharts();
  }

  renderReminders() {
    const reminders = this.computed.reminders || [];
    if (!reminders.length) return '';
    return `<div class="reminders">${reminders.slice(0, 2).map(r =>
      `<span class="reminder">${r.icon} ${r.text}</span>`).join('')}</div>`;
  }

  renderContextTags(formSuffix = '') {
    return `
      <div class="context-tags-container">
        <div class="context-tags-header">
          <span>💧</span>
          <strong>${t('context_tags_title')}</strong>
        </div>
        <p class="context-tags-hint">${t('context_tags_hint')}</p>
        <div class="context-tags-grid">
          <label class="context-tag-chip">
            <input type="checkbox" name="isSodiumSpike" id="sodium-spike-checkbox${formSuffix}">
            <span>${t('tag_sodium_spike')}</span>
          </label>
          <label class="context-tag-chip">
            <input type="checkbox" name="heavyLegDay" id="heavy-leg-checkbox${formSuffix}">
            <span>${t('tag_heavy_leg_day')}</span>
          </label>
          <label class="context-tag-chip">
            <input type="checkbox" name="creatineLoading" id="creatine-checkbox${formSuffix}">
            <span>${t('tag_creatine_loading')}</span>
          </label>
          <label class="context-tag-chip">
            <input type="checkbox" name="hormonalCycleStart" id="hormonal-checkbox${formSuffix}">
            <span>${t('tag_hormonal_cycle')}</span>
          </label>
          <label class="context-tag-chip">
            <input type="checkbox" name="poorSleepStress" id="poor-sleep-checkbox${formSuffix}">
            <span>${t('tag_poor_sleep_stress')}</span>
          </label>
        </div>
      </div>`;
  }

  renderDashboard() {
    const { state, computed: c } = this;
    const units = state.settings.units;
    const cycle = state.currentCycle;
    const trend = c.trendData?.latest;
    const rate = c.trendData?.rate;
    const phase = cycle.phase === PHASE.BULK ? 'LEAN BULK' : 'MINICUT';
    const pp = c.phaseProgress;
    const cal = c.calibration;
    const health = getDataHealthSummary(state);

    const trustBanner = `
      <div class="card card-info">
        <strong>Masscience estimates, it does not measure.</strong>
        <p class="hint">Body fat, TDEE, and projections are probabilistic estimates. Use your own judgment, log real-world feedback, and do not treat the app as a medical or laboratory instrument.</p>
      </div>`;

    let calBanner = '';
    if (cal && !cal.complete) {
      calBanner = `<div class="card card-info"><strong>Calibration</strong> Day ${cal.day} / ${cal.total}
        <p class="hint">Masscience is learning your normal weight fluctuations and establishing your bodyweight trend.</p></div>`;
    }

    const weightDisplay = trend
      ? formatWeight(trend.trend, units)
      : formatWeight(state.profile.weightKg, units);

    const rateDisplay = rate?.perWeek != null
      ? `${rate.perWeek >= 0 ? '↑' : '↓'} ${rate.perWeek >= 0 ? '+' : ''}${round(rate.perWeek, 2)} kg/week (${rate.perWeekPercent != null ? round(rate.perWeekPercent, 2) + '% BW/wk' : ''})`
      : 'Collecting data...';

    const projW = c.projection?.weight;
    const projBf = c.projection?.bf;
    const waterMl = typeof c.water === 'object' ? c.water.ml : c.water;

    let transitionBanner = '';
    const daysSinceSwitch = state.algorithmState?.daysSincePhaseSwitch ?? state.algorithmState?.daysInPhase ?? 999;
    if (daysSinceSwitch <= 10 && cycle.phase) {
      transitionBanner = `<div class="card card-info"><strong>Phase Transition (Day ${daysSinceSwitch}/10)</strong>
        <p class="hint">Stabilizing transient glycogen and water storage. Controller is in damped transition mode.</p></div>`;
    }

    return `
      ${trustBanner}
      ${health.warnings.length ? `<div class="card card-warning"><strong>Data check</strong><p class="hint">${health.warnings.join(' ')}</p></div>` : ''}
      ${calBanner}
      ${transitionBanner}
      ${c.risk?.level === 'HIGH' || c.risk?.level === 'MODERATE' ? `
      <div class="card card-warning"><strong>Estimated trajectory risk: ${c.risk.label || c.risk.level}</strong><p>${escapeHtml(c.risk.message)}</p>
        ${c.risk.modelProbability != null ? `<p class="hint">~${Math.round(c.risk.modelProbability * 100)}% model-estimated probability (not clinical). ${escapeHtml(c.risk.disclaimer || '')}</p>` : ''}</div>` : ''}
      <div class="card card-hero">
        <div class="phase-label">${phase}</div>
        <div class="week-label">Week ${pp.currentWeek} / ${pp.totalWeeks}</div>
        <div class="hero-weight">${weightDisplay}</div>
        <div class="hero-rate">${rateDisplay}</div>
        ${this.statusBadge(c.calorieAdj?.status || 'neutral')}
        <p class="status-message">${escapeHtml(c.calorieAdj?.message || '')}</p>
      </div>

      <div class="card-grid">
        <div class="card card-stat">
          <span class="stat-label">Estimated BF</span>
          <span class="stat-value">${c.bfEstimate?.estimate != null ? `${c.bfEstimate.estimate}%` : '—'}</span>
          <span class="stat-hint">Faixa provável: ${c.bfEstimate?.low}–${c.bfEstimate?.high}%</span>
        </div>
        <div class="card card-stat">
          <span class="stat-label">Target maximum</span>
          <span class="stat-value">~${cycle.maxBf}%</span>
        </div>
        <div class="card card-stat">
          <span class="stat-label">Projected finish</span>
          <span class="stat-value">${projW ? formatWeight(projW.estimate ?? projW, units) : '—'}</span>
          <span class="stat-hint">${projBf ? `~${projBf.estimate ?? projBf}% (${projBf.low}–${projBf.high}%)` : ''}</span>
        </div>
        <div class="card card-stat">
          <span class="stat-label">Trend confidence</span>
          <span class="stat-value">${formatConfidenceLabel(c.trendData?.confidenceDetail?.label || 'low')}</span>
          <span class="stat-hint">${c.trendData?.confidence ?? 0}%</span>
        </div>
      </div>

      ${shouldWeighToday(state) ? `
      <div class="card">
        <h3>${t('card_weigh_in_title')}</h3>
        <form id="weigh-in-form">
          <div class="form-row">
            <input type="number" name="weight" step="0.1" placeholder="Weight (${units === 'imperial' ? 'lb' : 'kg'})" required>
            <button type="submit" class="btn btn-primary">${t('btn_save_weigh_in')}</button>
          </div>
          ${this.renderContextTags()}
        </form>
        ${trend?.measured != null ? `<p class="hint">Last measured: ${formatWeight(trend.measured, units)} · Trend: ${formatWeight(trend.trend, units)}</p>` : ''}
      </div>` : `
      <div class="card card-info">
        <h3>Next Weigh-in</h3>
        <p>${c.nextWeighIn === today() ? 'Tomorrow' : c.nextWeighIn}</p>
        <details style="margin-top: 0.5rem;">
          <summary style="cursor: pointer; font-size: 0.85rem; color: var(--accent);">Log weight anyway today</summary>
          <form id="weigh-in-form" style="margin-top: 0.5rem;">
            <div class="form-row">
              <input type="number" name="weight" step="0.1" placeholder="Weight (${units === 'imperial' ? 'lb' : 'kg'})" required>
              <button type="submit" class="btn btn-primary">${t('btn_save_weigh_in')}</button>
            </div>
            ${this.renderContextTags('-extra')}
          </form>
        </details>
      </div>`}

      <div class="card">
        <h3>Today</h3>
        <div class="macro-grid">
          <div><span class="macro-label">Calories</span><span class="macro-value">${formatCalories(c.macros?.calories)}</span></div>
          <div><span class="macro-label">Protein</span><span class="macro-value">${c.macros?.protein} g</span></div>
          <div><span class="macro-label">Carbs</span><span class="macro-value">${c.macros?.carbs} g</span></div>
          <div><span class="macro-label">Fat</span><span class="macro-value">${c.macros?.fat} g</span></div>
          <div><span class="macro-label">Water</span><span class="macro-value">~${typeof c.water === 'object' ? c.water.display : formatLiters(waterMl)} L</span></div>
        </div>
      </div>

      ${c.calorieAdj?.shouldAdjust ? `
      <div class="card card-adjustment">
        <h3>Recommended Adjustment</h3>
        <p>${formatCalories(state.algorithmState.currentCalories)} → ${formatCalories(c.calorieAdj.recommendedCalories)}</p>
        <p class="hint">${c.calorieAdj.adjustment > 0 ? '+' : ''}${c.calorieAdj.adjustment} kcal/day</p>
        <p class="hint"><strong>Why this changed:</strong> ${escapeHtml(c.calorieAdj.reasoning || c.calorieAdj.message || '')}</p>
        <ul class="explanation-list">
          <li>Trend rate: ${round(rate?.perWeek ?? 0, 2)} kg/week</li>
          <li>Target rate: ${round(c.gainRange?.target ?? 0, 2)} kg/week</li>
          <li>Trend confidence: ${c.trendData?.confidence ?? 0}%</li>
          <li>Body-fat estimate: ~${c.bfEstimate?.estimate ?? 'n/a'}%</li>
        </ul>
        <button class="btn btn-primary" data-action="apply-calories">Apply Adjustment</button>
      </div>` : ''}

      <div class="card">
        <h3>Weight Trend</h3>
        <canvas id="chart-weight-mini" class="chart" height="160"></canvas>
      </div>

      <p class="footer-note"><a href="#" data-nav="learn">How does this work?</a></p>`;
  }

  renderProgress() {
    const { computed: c, state } = this;
    const rate = c.trendData?.rate;

    return `
      <h2 class="page-title">Progress</h2>
      <div class="card">
        <h3>Weight</h3>
        ${rate?.perWeek != null ? `<p class="metric-inline">Rate: <strong>${rate.perWeek >= 0 ? '+' : ''}${round(rate.perWeek, 2)} kg/week</strong> (±${rate.standardError ?? '?'} SE) · ${formatConfidenceLabel(c.trendData.confidenceDetail?.label)} ${c.trendData.confidence}%</p>` : ''}
        <canvas id="chart-weight" class="chart" height="220"></canvas>
        <div class="chart-legend">
          <span class="legend-dot measured"></span> Measured
          <span class="legend-dot estimated"></span> Estimated
          <span class="legend-dot trend"></span> Trend
          <span class="legend-dot target"></span> Target
        </div>
      </div>
      <div class="card">
        <h3>Body Fat (Estimated)</h3>
        <canvas id="chart-bf" class="chart" height="180"></canvas>
      </div>
      <div class="card">
        <h3>Calorie Adjustments</h3>
        <canvas id="chart-calories" class="chart" height="160"></canvas>
      </div>
      <div class="card">
        <h3>Aprendizado Adaptativo do TDEE</h3>
        <div class="tdee-display">
          <div><span class="stat-label">TDEE Inicial</span><span>${formatCalories(state.currentCycle.initialTDEE)}</span></div>
          <div><span class="stat-label">TDEE Estimado</span><span>${formatCalories(c.tdeeResult?.estimate ?? state.algorithmState.estimatedTDEE)} / dia</span></div>
          <div><span class="stat-label">Faixa Provável</span><span>${formatCalories(c.tdeeResult?.low)} – ${formatCalories(c.tdeeResult?.high)}</span></div>
          <div><span class="stat-label">Confiança</span><span>${formatConfidenceLabel(c.tdeeResult?.confidenceDetail?.label)} (${state.algorithmState.tdeeConfidence}%)</span></div>
        </div>
        <p class="hint">TDEE estimado probabilístico com faixa provável de incerteza (±${c.tdeeResult?.uncertainty ?? 180} kcal). Flutuações agudas de glicogênio e hidratação são isoladas para evitar oscilações artificiais.</p>
      </div>`;
  }

  renderCyclePage() {
    const { state, computed: c } = this;
    const cycle = state.currentCycle;
    const timeline = c.timeline || [];

    return `
      <h2 class="page-title">Cycle #${cycle.number}</h2>
      ${cycle.paused ? '<div class="card card-warning">Cycle paused</div>' : ''}
      <div class="card">
        <div class="cycle-phase-header">
          <span class="phase-badge ${cycle.phase}">${cycle.phase === PHASE.BULK ? 'BULK' : 'MINICUT'}</span>
          <span>Week ${c.phaseProgress.currentWeek} / ${c.phaseProgress.totalWeeks}</span>
        </div>
        <div class="timeline">
          ${timeline.map(t => `
            <div class="timeline-item ${t.active ? 'active' : ''} ${t.completed ? 'completed' : ''}">
              <span class="timeline-phase">${t.phase === PHASE.BULK ? 'B' : 'M'}</span>
              <span class="timeline-label">${t.label}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>Weigh-in Frequency</h3>
        <p>${this.formatFrequency(state.algorithmState.weighInFrequency)}</p>
        ${c.calibration && !c.calibration.complete
          ? `<p class="hint">Calibration: Day ${c.calibration.day}/${c.calibration.total} — daily weighing</p>` : ''}
      </div>
      <div class="card">
        <h3>Cycle Controls</h3>
        <div class="btn-row">
          ${cycle.paused
            ? '<button class="btn btn-primary" data-action="resume-cycle">Resume</button>'
            : '<button class="btn btn-secondary" data-action="pause-cycle">Pause</button>'}
          <button class="btn btn-ghost" data-action="reset-cycle">Reset Cycle</button>
        </div>
      </div>`;
  }

  formatFrequency(freq) {
    const map = { daily: 'Daily', every_other: 'Every other day', three_weekly: '3× per week' };
    return map[freq] || freq;
  }

  renderBodyPage() {
    const { state, computed: c } = this;
    const units = state.settings.units;
    const weight = c.trendData?.latest?.trend || state.profile.weightKg;
    const comp = c.compRange || compositionRange(weight, c.bfEstimate);
    const ffmi = calculateFFMI(comp.leanMass.mid, state.profile.heightCm);

    return `
      <h2 class="page-title">Body</h2>
      <p class="hint">${c.bfEstimate.note || 'Massa livre de gordura estimada ≠ tecido muscular isolado'}</p>
      <div class="card-grid">
        <div class="card card-stat"><span class="stat-label">Peso de tendência</span><span class="stat-value">${formatWeight(weight, units)}</span></div>
        <div class="card card-stat">
          <span class="stat-label">Gordura corporal estimada (%BF)</span>
          <span class="stat-value">${c.bfEstimate.estimate}%</span>
          <span class="stat-range">Faixa: ${c.bfEstimate.low}–${c.bfEstimate.high}%</span>
          <span class="stat-hint">${formatConfidenceLabel(c.bfEstimate.confidenceDetail?.label)}</span>
        </div>
        <div class="card card-stat">
          <span class="stat-label">Massa livre de gordura estimada</span>
          <span class="stat-value">~${formatWeight(comp.leanMass.mid, units)}</span>
          <span class="stat-range">Faixa: ${formatWeight(comp.leanMass.low, units)}–${formatWeight(comp.leanMass.high, units)}</span>
        </div>
        <div class="card card-stat">
          <span class="stat-label">Tecido adiposo estimado</span>
          <span class="stat-value">~${formatWeight(comp.fatMass.mid, units)}</span>
          <span class="stat-range">Faixa: ${formatWeight(comp.fatMass.low, units)}–${formatWeight(comp.fatMass.high, units)}</span>
        </div>
        <div class="card card-stat"><span class="stat-label">FFMI estimado</span><span class="stat-value">~${round(ffmi, 1)}</span></div>
      </div>
      <button class="btn btn-secondary" data-action="update-bf">Update BF Estimate</button>

      <div class="card">
        <h3>Modelo Fisiológico Latente (6 Compartimentos)</h3>
        <p class="hint">Com base nos seus dados e no comportamento observado, nosso modelo estima uma faixa provável de ganho muscular e gordura. Os resultados podem variar significativamente devido à genética, treinamento, dieta, sono e mudanças na atividade.</p>
        <div class="macro-grid">
          <div><span class="macro-label">Massa muscular estimada</span><span class="macro-value">${formatWeight(comp.contractileMuscle?.low, units)}–${formatWeight(comp.contractileMuscle?.high, units)}</span></div>
          <div><span class="macro-label">Massa magra estrutural</span><span class="macro-value">~${formatWeight(comp.structuralLean?.mid, units)}</span></div>
          <div><span class="macro-label">Glicogênio estimado</span><span class="macro-value">~${comp.glycogen?.mid} kg</span></div>
          <div><span class="macro-label">Água corporal estimada</span><span class="macro-value">~${formatWeight(comp.hydrationWater?.mid, units)}</span></div>
          <div><span class="macro-label">Conteúdo digestivo</span><span class="macro-value">~${comp.digestive?.mid} kg</span></div>
          <div><span class="macro-label">Tecido adiposo estimado</span><span class="macro-value">${formatWeight(comp.fatMass.low, units)}–${formatWeight(comp.fatMass.high, units)}</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Body Check (Opcional)</h3>
        <p class="hint">A cada 2–4 semanas. Insira exames laboratoriais, dobras com adipômetro ou medidas corporais opcionais.</p>
        <form id="body-check-form">
          <div class="form-grid">
            <div class="form-group"><label>BF direto (%) — Exame / DEXA / Adipômetro</label><input type="number" name="bodyFatPercent" step="0.1" min="3" max="50" placeholder="Ex: 12.5"></div>
            <div class="form-group"><label>Origem do BF</label>
              <select name="method">
                <option value="direct">DEXA / Exame Clínico (Mais preciso)</option>
                <option value="caliper">Adipômetro / Dobras Cutâneas</option>
                <option value="bia">Bioimpedância (Balança)</option>
                <option value="manual">Estimativa Visual / Outro</option>
              </select>
            </div>
            ${state.profile.sex === 'female' ? `
            <div class="form-group"><label>Dobra Tríceps (mm)</label><input type="number" name="triceps" step="0.5"></div>
            <div class="form-group"><label>Dobra Supra-ilíaca (mm)</label><input type="number" name="suprailiac" step="0.5"></div>
            <div class="form-group"><label>Dobra Coxa (mm)</label><input type="number" name="thighFold" step="0.5"></div>
            ` : `
            <div class="form-group"><label>Dobra Peitoral (mm)</label><input type="number" name="chestFold" step="0.5"></div>
            <div class="form-group"><label>Dobra Abdominal (mm)</label><input type="number" name="abdomenFold" step="0.5"></div>
            <div class="form-group"><label>Dobra Coxa (mm)</label><input type="number" name="thighFold" step="0.5"></div>
            `}
            <div class="form-group"><label>Cintura (cm) — opcional</label><input type="number" name="waist" step="0.1"></div>
            <div class="form-group"><label>Braço (cm) — opcional</label><input type="number" name="arm" step="0.1"></div>
            <div class="form-group"><label>Pescoço (cm) — opcional</label><input type="number" name="neck" step="0.1"></div>
            <div class="form-group"><label>Coxa (cm) — opcional</label><input type="number" name="thigh" step="0.1"></div>
            ${state.profile.sex === 'female' ? '<div class="form-group"><label>Quadril (cm) — opcional</label><input type="number" name="hip" step="0.1"></div>' : ''}
            <div class="form-group form-group-full"><label>Foto de progresso (opcional, privada local)</label>
              <input type="file" name="photo" accept="image/*" id="body-photo-input"></div>
          </div>
          <button type="submit" class="btn btn-primary">Salvar Body Check</button>
        </form>
      </div>

      ${state.bodyMeasurements.length ? `
      <div class="card">
        <h3>Measurement History</h3>
        ${state.bodyMeasurements.slice().reverse().map((m, idx, arr) => {
          let interpretation = '';
          if (idx < arr.length - 1) {
            const prev = arr[idx + 1];
            const wDelta = (c.trendData?.latest?.trend || state.profile.weightKg) - state.profile.weightKg;
            const waistDelta = m.waist && prev.waist ? m.waist - prev.waist : null;
            if (waistDelta !== null) {
              interpretation = waistDelta < 0.5 && wDelta > 0
                ? 'Likely controlled gain'
                : waistDelta > 1
                  ? 'Waist increase notable — monitor trend'
                  : 'Within expected range';
            }
          }
          return `
          <div class="history-entry">
            <strong>${m.date}</strong>
            ${m.waist ? `Waist: ${m.waist} cm` : ''} ${m.neck ? `· Neck: ${m.neck} cm` : ''}
            ${interpretation ? `<span class="hint">${interpretation} — approximate, not certain</span>` : ''}
            ${m.photo ? '<span class="hint">📷 Photo saved locally</span>' : ''}
          </div>`;
        }).join('')}
      </div>` : '<div class="card empty-state"><p>Add a Body Check to improve your body-composition estimate.</p></div>'}`;
  }

  renderNutritionPage() {
    const { state, computed: c } = this;
    const portions = portionGuide(c.macros);
    const showPortions = state.settings.showPortionGuide;

    return `
      <h2 class="page-title">Nutrition</h2>
      <div class="card card-hero">
        <div class="hero-calories">${formatCalories(c.macros.calories)}</div>
        <p class="hint">Adaptive target · No food logging required</p>
      </div>
      <div class="card">
        <div class="macro-grid macro-grid-lg">
          <div><span class="macro-label">Protein</span><span class="macro-value">${c.macros.protein} g</span></div>
          <div><span class="macro-label">Carbohydrates</span><span class="macro-value">${c.macros.carbs} g</span></div>
          <div><span class="macro-label">Fat</span><span class="macro-value">${c.macros.fat} g</span></div>
          <div><span class="macro-label">Water</span><span class="macro-value">~${typeof c.water === 'object' ? c.water.display : formatLiters(waterMl)} L</span></div>
        </div>
      </div>

      <div class="card card-info">
        <p><strong>You don't need to weigh every meal.</strong></p>
        <p>Masscience adjusts your calorie target based on weight trends.</p>
        <button class="btn btn-ghost" data-action="toggle-portions">${showPortions ? 'Hide' : 'Show'} Portion Guide</button>
      </div>

      ${showPortions ? `
      <div class="card">
        <h3>Portion Guide</h3>
        <div class="portion-grid">
          <div><strong>Protein:</strong> ${portions.protein.min}–${portions.protein.max} portions/day</div>
          <div><strong>Carbohydrates:</strong> ${portions.carbs.min}–${portions.carbs.max} portions/day</div>
          <div><strong>Fats:</strong> ${portions.fat.min}–${portions.fat.max} portions/day</div>
        </div>
        <details class="portion-details">
          <summary>What is a portion?</summary>
          <ul>
            <li><strong>Protein portion:</strong> ~30g (e.g., palm-sized chicken, 1 scoop whey)</li>
            <li><strong>Carb portion:</strong> ~40g (e.g., 1 cup cooked rice, 2 slices bread)</li>
            <li><strong>Fat portion:</strong> ~15g (e.g., 1 tbsp olive oil, small handful nuts)</li>
          </ul>
        </details>
      </div>` : ''}

      ${c.safety?.length ? `<div class="card card-warning">${c.safety.map(w => `<p>${w}</p>`).join('')}</div>` : ''}`;
  }

  renderFuturePage() {
    const { computed: c } = this;
    const milestones = c.fullProjection || [];

    return `
      <h2 class="page-title">Future Body</h2>
      <p class="page-subtitle">Projections based on current trend — not guarantees.</p>
      <div class="card">
        <canvas id="chart-projection" class="chart" height="200"></canvas>
      </div>
      <div class="card">
        <h3>Milestones</h3>
          ${milestones.map(m => `
          <div class="milestone">
            <span class="milestone-label">${m.label}</span>
            <span class="milestone-weight">${m.weight}${m.weightRange ? ` (${m.weightRange})` : ''} kg</span>
            <span class="milestone-bf">~${m.bf}${m.bfRange ? ` (${m.bfRange})` : ''}% BF${m.ffmi ? ` · FFMI ${m.ffmi}` : ''}</span>
          </div>`).join('')}
      </div>

      <div class="card">
        <h3>What If?</h3>
        <p class="hint">Scenario simulator — approximate projections.</p>
        <div class="scenario-table">
          <div class="scenario-header"><span>Rate</span><span>End Bulk</span><span>After Minicut</span><span>Ceiling risk</span></div>
          ${(c.scenarios || []).map(s => `
            <div class="scenario-row">
              <span>+${round(s.gainRate, 2)} kg/wk</span>
              <span>${s.bulk.weight} kg · BF ${s.bulk.bfRange}</span>
              <span>${s.minicut.weight} kg · BF ${s.minicut.bfRange}</span>
              <span>${s.modelProbabilityExceedCeiling != null ? '~' + Math.round(s.modelProbabilityExceedCeiling * 100) + '%' : '—'}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  renderHistoryPage() {
    const { state, computed: c } = this;
    const history = state.cycleHistory;

    if (!history.length && !state.weightMeasurements.length) {
      return `<h2 class="page-title">History</h2>
        <div class="card empty-state"><p>Complete your first cycle to start building your history.</p></div>`;
    }

    return `
      <h2 class="page-title">History</h2>
      ${history.map(h => `
        <div class="card">
          <h3>Cycle #${h.number}</h3>
          <p>${h.startDate} → ${h.endDate}</p>
          <p>Bulk: ${round(h.initialWeight, 1)} → ${round(h.finalWeight, 1)} kg</p>
          <p>Calorie adjustments: ${h.calorieAdjustments}</p>
        </div>`).join('')}
      <div class="card">
        <h3>Current Cycle Weigh-ins</h3>
        <p class="hint">${state.weightMeasurements.filter(m => !m.isEstimated).length} measured · ${state.weightMeasurements.filter(m => m.isEstimated).length} estimated</p>
        <div class="weigh-in-history-list" style="margin-top: 0.8rem; display: flex; flex-direction: column; gap: 0.4rem; max-height: 240px; overflow-y: auto;">
          ${state.weightMeasurements.filter(m => !m.isEstimated).slice(-15).reverse().map(m => `
            <div class="history-entry" style="display: flex; justify-content: space-between; align-items: center; padding: 0.45rem 0.65rem; background: rgba(255,255,255,0.02); border-radius: var(--radius); font-size: 0.85rem;">
              <span><strong>${m.date}</strong>: ${m.weight} kg</span>
              <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">
                ${m.fluidTags && m.fluidTags.length ? m.fluidTags.map(tag => {
                  if (tag === 'sodium_spike') return '<span class="badge-tag badge-tag-sodium">🧂 Sódio</span>';
                  if (tag === 'heavy_leg_day') return '<span class="badge-tag badge-tag-doms">🏋️ DOMS</span>';
                  if (tag === 'creatine_loading') return '<span class="badge-tag badge-tag-creatine">💊 Creatina</span>';
                  if (tag === 'hormonal_cycle') return '<span class="badge-tag badge-tag-creatine">💉 Hormonal</span>';
                  if (tag === 'poor_sleep_stress') return '<span class="badge-tag badge-tag-sleep">💤 Sono</span>';
                  return '<span class="badge-tag">💧 Fluido</span>';
                }).join('') : (m.isSodiumSpike ? '<span class="badge-tag badge-tag-sodium">🧂 Sódio</span>' : (m.isOutlier ? '<span class="status-badge status-neutral" style="font-size: 0.72rem; padding: 2px 6px;">💧 Retenção</span>' : '<span style="color: var(--text-muted); font-size: 0.75rem;">Normal</span>'))}
              </div>
            </div>
          `).join('') || '<p class="hint">No measurements recorded yet.</p>'}
        </div>
      </div>
      <div class="card">
        <h3>Scientific Cycle Report</h3>
        <p class="hint">Export the complete compartmental report with 6-compartment body estimates, latent TDEE tracking, and controller adjustments.</p>
        <button class="btn btn-primary" data-action="export-report">Download Scientific Cycle Report</button>
      </div>
      <div class="card">
        <h3>Calorie History</h3>
        ${state.calorieHistory.slice().reverse().map(c => `
          <div class="history-entry">
            <strong>${c.date}</strong>: ${c.previous} → ${c.new} kcal (${c.adjustment >= 0 ? '+' : ''}${c.adjustment})
            <span class="hint">${c.reason}</span>
          </div>`).join('') || '<p class="hint">No adjustments yet.</p>'}
      </div>`;
  }

  renderSettingsPage() {
    const { state } = this;
    const latestBackup = getLatestBackup();
    const health = getDataHealthSummary(state);

    return `
      <h2 class="page-title">Settings</h2>
      <div class="card">
        <h3>Profile</h3>
        <p>${state.profile.sex}, ${state.profile.age} yrs · ${formatHeight(state.profile.heightCm, state.settings.units)} · ${formatWeight(state.profile.weightKg, state.settings.units)}</p>
      </div>
      <div class="card">
        <h3>Reports & Exports</h3>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="export-report">Download Cycle Report (JSON)</button>
          <button class="btn btn-secondary" data-action="export">Full State Backup (JSON)</button>
        </div>
      </div>
      <div class="card">
        <h3>Backup & Recovery</h3>
        <div class="btn-row">
          <button class="btn btn-secondary" data-action="backup-now">Create local backup</button>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" data-action="restore-backup">Restore latest backup</button>
          <button class="btn btn-ghost" data-action="clear-backups">Clear saved backups</button>
        </div>
        <p class="hint">${latestBackup ? `Latest local backup: ${latestBackup.date} at ${latestBackup.timestamp.slice(11, 16)}` : 'No local backup yet.'}</p>
      </div>
      <div class="card">
        <h3>Data health check</h3>
        <p class="hint">Last saved: ${state.lastSavedAt || 'n/a'} · Age: ${health.daysSinceSave} days</p>
        ${health.warnings.length ? `<ul class="explanation-list">${health.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '<p class="hint">No data integrity warnings.</p>'}
      </div>
      <div class="card">
        <h3>Preferences</h3>
        <div class="form-group"><label>${t('settings_language')}</label>
          <select id="language-select" onchange="window.masscience.setLanguage(this.value)">
            ${SUPPORTED_LANGUAGES.map(l => `<option value="${l.id}" ${(state.settings.language || getLanguage()) === l.id ? 'selected' : ''}>${l.flag} ${l.name}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Theme</label>
          <select id="theme-select" onchange="window.masscience.setTheme(this.value)">
            <option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="system" ${state.settings.theme === 'system' ? 'selected' : ''}>System</option>
          </select></div>
        <div class="form-group"><label>Units</label>
          <select id="units-select" onchange="window.masscience.setUnits(this.value)">
            <option value="metric" ${state.settings.units === 'metric' ? 'selected' : ''}>Metric</option>
            <option value="imperial" ${state.settings.units === 'imperial' ? 'selected' : ''}>Imperial</option>
          </select></div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" ${state.settings.notifications ? 'checked' : ''} onchange="window.masscience.toggleNotifications(this.checked)">
            In-app &amp; browser reminders
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" ${state.settings.showAlgorithmDetails ? 'checked' : ''} onchange="window.masscience.toggleDebug(this.checked)">
            Show algorithm debug panel
          </label>
        </div>
      </div>
      ${state.settings.showAlgorithmDetails ? this.renderDebugPanel() : ''}
      <div class="card">
        <h3>Data</h3>
        <div class="btn-row">
          <button class="btn btn-secondary" data-action="export">Export JSON</button>
          <button class="btn btn-secondary" data-action="import">Import JSON</button>
          <input type="file" id="import-file" accept=".json" hidden>
        </div>
        <button class="btn btn-ghost btn-danger" data-action="reset-all">Reset Application</button>
        <button class="btn btn-ghost" data-action="clear-demo">Clear & Start Fresh</button>
      </div>
      <div class="card">
        <h3>About</h3>
        <p class="hint">App version: ${APP_VERSION}</p>
        <p class="hint">Algorithm ${state.algorithmVersion || ALGORITHM_VERSION}</p>
        <a href="#" data-nav="about" class="link">Open app information</a>
        <a href="#" data-nav="learn" class="link">How does this work?</a>
      </div>
      <p class="footer-note disclaimer">Masscience is a tracking/estimation tool, not a medical device. Consult a qualified professional for personalized advice.</p>`;
  }

  renderAboutPage() {
    return `
      <h2 class="page-title">About Masscience</h2>
      <div class="card card-hero">
        <div class="phase-label">MASSCIENCE</div>
        <div class="hero-weight">v${APP_VERSION}</div>
        <p class="hint">Lean bulk on autopilot</p>
      </div>
      <div class="card">
        <h3>Application info</h3>
        <div class="tdee-display">
          <div><span class="stat-label">App</span><span>Masscience</span></div>
          <div><span class="stat-label">Version</span><span>${APP_VERSION}</span></div>
          <div><span class="stat-label">Algorithm</span><span>${ALGORITHM_VERSION}</span></div>
          <div><span class="stat-label">Platform</span><span>${navigator.platform || 'Unknown'}</span></div>
          <div><span class="stat-label">Runtime</span><span>${navigator.userAgent.split(' ').slice(0, 2).join(' ') || 'Browser'}</span></div>
        </div>
      </div>
      <div class="card">
        <h3>Purpose</h3>
        <p>Masscience is a bodyweight-trend based fitness planning system for controlled muscle gain and lean phases without obsessing over daily noise.</p>
        <p class="hint">All personal data stays in local storage by default, and no backend is required.</p>
      </div>
      <a href="#" data-nav="dashboard" class="btn btn-primary">Back to Dashboard</a>`;
  }

  renderLearnPage() {
    return `
      <h2 class="page-title">How does this work?</h2>
      <div class="card"><h3>Why daily weight fluctuates</h3>
        <p>Water, glycogen, sodium, food volume, and hydration cause daily changes of 0.5–2 kg. These are normal and don't reflect true tissue change.</p></div>
      <div class="card"><h3>What trend weight means</h3>
        <p>Masscience uses exponential smoothing and regression to extract the underlying direction from noisy measurements.</p></div>
      <div class="card"><h3>Why one weigh-in doesn't change the plan</h3>
        <p>The adaptive engine requires trend evidence over multiple days before recommending calorie changes. Outliers are flagged but preserved.</p></div>
      <div class="card"><h3>How calorie adjustments work</h3>
        <p>Your actual rate of gain is compared to your target. Deviations outside a deadband trigger conservative adjustments (50–200 kcal), with a 7-day cooldown.</p></div>
      <div class="card"><h3>Why BF is an estimate</h3>
        <p>Sem exames laboratoriais diretos como DEXA, a gordura corporal não é absoluta. O Masscience combina sua estimativa inicial calibrada, balanço energético termodinâmico e tendências probabilísticas de peso, com calibração opcional por dobras ou exames diretos.</p></div>
      <div class="card"><h3>Weigh-in frequency</h3>
        <p>Daily weighing during calibration builds your trend model. As stability increases, frequency reduces to every-other-day, then 3× weekly.</p></div>
      <div class="card"><h3>Core principle</h3>
        <p class="emphasis">Don't obsess over individual numbers. Watch the trajectory.</p></div>
      <a href="#" data-nav="dashboard" class="btn btn-primary">Back to Dashboard</a>`;
  }

  renderCharts() {
    requestAnimationFrame(() => {
      const c = this.computed;
      const weightCanvas = document.getElementById('chart-weight');
      const weightMini = document.getElementById('chart-weight-mini');
      const bfCanvas = document.getElementById('chart-bf');
      const calCanvas = document.getElementById('chart-calories');
      const projCanvas = document.getElementById('chart-projection');

      const weightData = { series: c.trendData?.series || [], trajectory: c.trajectory || [] };

      if (weightCanvas) renderWeightChart(weightCanvas, weightData);
      if (weightMini) renderWeightChart(weightMini, weightData);
      if (bfCanvas) {
        const bfHistory = this.buildBfHistory();
        renderBFChart(bfCanvas, bfHistory, this.state.currentCycle?.maxBf);
      }
      if (calCanvas) renderCalorieChart(calCanvas, this.state.calorieHistory, this.state.algorithmState.currentCalories);
      if (projCanvas) renderProjectionChart(projCanvas, c.fullProjection || []);
    });
  }

  buildBfHistory() {
    const { state, computed: c } = this;
    const history = [];
    const measurements = state.weightMeasurements.filter(m => !m.isEstimated);
    measurements.forEach((m, i) => {
      const partialTrend = processWeightData(measurements.slice(0, i + 1), state.currentCycle.startDate);
      const bf = estimateBodyComposition(
        state.profile, partialTrend,
        state.bodyMeasurements.filter(b => b.date <= m.date),
        state.algorithmState
      ).bf;
      history.push({ date: m.date, bf: bf.estimate });
    });
    return history;
  }

  setTheme(theme) {
    this.state.settings.theme = theme;
    saveState(this.state);
    this.applyTheme();
  }

  setLanguage(lang) {
    this.state.settings.language = lang;
    setLanguage(lang);
    saveState(this.state);
    this.render();
  }

  setUnits(units) {
    this.state.settings.units = units;
    saveState(this.state);
    this.render();
  }

  toggleNotifications(enabled) {
    this.state.settings.notifications = enabled;
    saveState(this.state);
    if (enabled) this.requestNotificationPermission();
  }

  toggleDebug(enabled) {
    this.state.settings.showAlgorithmDetails = enabled;
    saveState(this.state);
    this.render();
  }

  renderDebugPanel() {
    const c = this.computed;
    const a = this.state.algorithmState;
    const series = c.trendData?.series ?? [];
    return `
      <div class="card debug-panel">
        <h3>Algorithm Debug (v2.1)</h3>
        <div class="debug-grid">
          <div><span>Measured count</span><strong>${c.trendData?.measuredCount ?? 0}</strong></div>
          <div><span>Trend method</span><strong>${c.trendData?.method ?? '—'}</strong></div>
          <div><span>Trend rate</span><strong>${c.trendData?.rate?.perWeek ?? '—'} kg/wk</strong></div>
          <div><span>Rate SE</span><strong>${c.trendData?.rate?.standardError ?? '—'}</strong></div>
          <div><span>Target rate</span><strong>${c.gainRange?.target} kg/wk (${c.gainRange?.targetPercent}% BW)</strong></div>
          <div><span>Rate error</span><strong>${c.calorieAdj?.rateError ?? '—'}</strong></div>
          <div><span>Trajectory error</span><strong>${c.trajectoryError?.errorKg ?? '—'} kg</strong></div>
          <div><span>Trend confidence</span><strong>${c.trendData?.confidence}% (${c.trendData?.confidenceDetail?.label})</strong></div>
          <div><span>Smoothed BF</span><strong>${a.smoothedBf ?? '—'}%</strong></div>
          <div><span>Est. TDEE</span><strong>${c.tdeeResult?.estimate} (${c.tdeeResult?.low}–${c.tdeeResult?.high})</strong></div>
          <div><span>TDEE confidence</span><strong>${a.tdeeConfidence}%</strong></div>
          <div><span>Calories</span><strong>${a.currentCalories} → adj ${c.calorieAdj?.adjustment ?? 0}</strong></div>
          <div><span>Control signal</span><strong>${c.calorieAdj?.controlSignal ?? 'weight_trajectory'}</strong></div>
          <div><span>BF estimate</span><strong>${c.bfEstimate?.estimate}% [${c.bfEstimate?.low}–${c.bfEstimate?.high}]</strong></div>
          <div><span>BF sources</span><strong>${(c.bfEstimate?.sources || []).join(', ')}</strong></div>
          <div><span>Projection W</span><strong>${c.projection?.weight?.estimate ?? '—'} [${c.projection?.weight?.low}–${c.projection?.weight?.high}]</strong></div>
          <div><span>Model P(exceed)</span><strong>${c.projection?.modelProbabilityExceedCeiling != null ? round(c.projection.modelProbabilityExceedCeiling * 100, 0) + '%' : '—'}</strong></div>
          <div><span>Trajectory risk</span><strong>${c.risk?.label ?? c.risk?.level}</strong></div>
          <div><span>Weigh-in freq</span><strong>${a.weighInFrequency}</strong></div>
          <div><span>Last noise</span><strong>${series.length ? series[series.length - 1].noise ?? '—' : '—'} kg</strong></div>
        </div>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.masscience = new MasscienceApp();

  document.addEventListener('change', (e) => {
    if (e.target.id === 'import-file' && e.target.files[0]) {
      importData(e.target.files[0]).then(data => {
        window.masscience.state = data;
        saveState(data);
        window.masscience.recompute();
        window.masscience.render();
      }).catch(err => alert(err.message));
    }
  });
});
