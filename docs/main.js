/**
 * Masscience — Landing Page Interactive Engine
 * Internationalization, Live Interactive Simulator, and UX micro-interactions
 */

document.addEventListener('DOMContentLoaded', () => {

  // =========================================================================
  // 1. Internationalization (i18n) Engine
  // =========================================================================
  const i18n = {
    pt: {
      nav_features: 'Recursos',
      nav_how: 'Como Funciona',
      nav_sim: 'Simulador',
      nav_science: 'A Ciência',
      nav_faq: 'Dúvidas',
      btn_open_app: 'Abrir App',
      hero_badge: 'Algoritmo Cibernético v2.4 • Sem pesar cada grama de comida',
      hero_title_1: 'Ganhe Massa Muscular no',
      hero_title_gradient: 'Piloto Automático.',
      hero_subtitle: 'O primeiro sistema adaptativo em malha fechada que calibra calorias e minicuts pela resposta real do seu corpo. Ignore oscilações de sódio, água e creatina enquanto constrói massa magra com precisão clínica.',
      hero_cta_primary: 'Começar Meu Ciclo Grátis',
      hero_cta_secondary: 'Ver Simulador Interativo',
      metric_correlation: 'Correlação de Tendência',
      metric_deficit_cap: 'Teto Seguro no Minicut',
      metric_muscle_preserved: 'Preservação Muscular',
      metric_privacy: 'Privado e Offline-First',
      mock_status_on_track: 'NO ALVO (+0.19 kg/sem)',
      mock_rec_title: 'Recomendação Calórica',
      badge_why: 'POR QUE OS APPS COMUNS FALHAM?',
      title_why: 'O Abismo Entre a Balança e o Seu Músculo Real',
      subtitle_why: 'Você comeu uma pizza no sábado e acordou na segunda com +1,5 kg. Foi gordura? Não. Foi retenção hídrica por sódio e glicogênio.',
      comp_old_badge: 'O JEITO TRADICIONAL & OBSESSIVO',
      comp_old_title: 'Contagem Neurótica & Pânico',
      comp_old_1_title: 'Pesar cada folha de alface',
      comp_old_1_desc: 'Você gasta 30 minutos diários registrando códigos de barras que possuem até 20% de margem de erro nos rótulos.',
      comp_old_2_title: 'Calculadoras estáticas de 1919',
      comp_old_2_desc: 'Fórmulas como Harris-Benedict assumem que o seu gasto energético diário é constante, ignorando a adaptação metabólica.',
      comp_old_3_title: 'Pânico com o peso da balança',
      comp_old_3_desc: 'Qualquer oscilação por água ou treino pesado de pernas faz o app cortar calorias bruscamente, arruinando o anabolismo.',
      comp_old_4_title: 'Minicuts intermináveis',
      comp_old_4_desc: 'Sem metas matemáticas de término, você perde semanas preciosas de ganho de massa ou queima tecido magro.',
      comp_new_badge: 'A ENGENHARIA DO MASSCIENCE',
      comp_new_title: 'Controle em Malha Fechada Adaptativo',
      comp_new_1_title: 'Seu corpo é a melhor balança de alimentos',
      comp_new_1_desc: 'Em vez de pesar comida, você alimenta o modelo com pesagens consistentes e ele deduz seu TDEE latente automaticamente.',
      comp_new_2_title: 'Desacoplamento de ruído hídrico',
      comp_new_2_desc: 'Filtro de inércia tecidual ignora picos de pizza, creatina, DOMS muscular e estresse agudo sem corromper o histórico real.',
      comp_new_3_title: 'Ajustes calóricos com amortecimento',
      comp_new_3_desc: 'O controlador opera com deadband e cooldown de 7 dias. Sem flutuações violentas: apenas micro-ajustes inteligentes.',
      comp_new_4_title: 'Minicuts de 21 dias com teto de 650 kcal',
      comp_new_4_desc: 'Foco estrito em retornar ao BF inicial do ciclo com preservação de 99.9% de massa magra, engatando no próximo bulk.',
      badge_sim: 'EXPERIMENTE AO VIVO',
      title_sim: 'Veja o Algoritmo Amortecendo o Ruído',
      subtitle_sim: 'Simule um evento comum: você estava em lean bulk perfeito e comeu muito sódio ou treinou pernas pesadíssimo. Veja como o Masscience protege suas calorias:',
      sim_weight_label: 'Peso Base do Atleta:',
      sim_event_label: 'Selecione o Evento Atípico:',
      sim_chart_title: 'Resposta do Algoritmo Masscience',
      legend_raw: 'Balança Bruta',
      legend_filtered: 'Tendência Masscience',
      res_measured_jump: 'Salto na Balança',
      res_tissue_trend: 'Variação de Tendência',
      res_controller_decision: 'Decisão do Controlador',
      res_keep_calories: 'Manter Calorias Estáveis (Sem Pânico)',
      badge_features: 'RECURSOS DE ELITE',
      title_features: 'Construído para Atletas que Levam Resultados a Sério',
      subtitle_features: 'Cada linha de código do Masscience foi concebida para resolver problemas reais da fisiologia humana e eliminar o atrito psicológico.',
      feat_1_title: 'Nutrição Sem Pesar Comida',
      feat_1_desc: 'Chega de escanear código de barras de tudo que come. Com base na sua taxa de ganho e no gasto adaptativo, o app sugere ajustes práticos como "+1 colher de pasta de amendoim ou +1 banana".',
      feat_2_title: 'Minicuts que São Realmente "Mini"',
      feat_2_desc: 'Objetivo inegociável de retornar ao percentual de gordura inicial em cerca de 21 dias, respeitando um teto absoluto de 650 kcal de déficit diário para blindar seus ganhos musculares.',
      feat_3_title: 'Ciclos Contínuos Infinitos',
      feat_3_desc: 'Terminou o minicut? O Masscience calcula automaticamente seu novo ponto de partida e avança para o próximo Lean Bulk (Ciclo #2, #3, #N) sem você precisar reconfigurar tudo do zero.',
      feat_4_title: 'Tags Fisiológicas no Check-in',
      feat_4_desc: 'Botões de 1 toque para noites mal dormidas, treino pesado de pernas, início de creatina e refeições livres. O sistema amortiza a retenção hídrica sem mascarar seus dados brutos.',
      feat_5_title: 'Projeção Probabilística Monte Carlo',
      feat_5_desc: 'Com base em mais de 800 simulações probabilísticas, visualize com honestidade científica as faixas prováveis de peso e gordura corporal no final das 10 semanas de ciclo.',
      feat_6_title: '4 Abas Mobile e 100% Offline',
      feat_6_desc: 'Interface reformulada com 4 abas ergonômicas para uso com uma mão. Seus dados são seus: armazenados no seu dispositivo sem servidores obscuros ou anúncios invasivos.',
      badge_science: 'RIGOR MATEMÁTICO',
      title_science: 'Engenharia Biomédica Transformada em Código',
      desc_science_1: 'Enquanto outros aplicativos usam suposições ingênuas, o Masscience implementa princípios de compartimentalização tecidual (Forbes / P-Ratio), filtro de inércia tecidual e controle proporcional com zona morta (deadband).',
      desc_science_2: 'Em testes rigorosos contra simulações fisiológicas de 180 dias com ground-truth de 6 compartimentos corporais, o algoritmo v2.4 alcançou correlação média de 0.9942 na extração da tendência e 100% de precisão de meta nos testes Monte Carlo.',
      badge_faq: 'TIRE SUAS DÚVIDAS',
      title_faq: 'Perguntas Frequentes',
      subtitle_faq: 'Tudo o que você precisa saber sobre como o Masscience funciona na prática.',
      faq_1_q: 'Preciso pesar tudo o que eu comer no aplicativo?',
      faq_1_a: 'Não! Essa é exatamente a maior proposta de valor do Masscience. Em vez de se escravizar pesando 150g de arroz e 120g de frango a cada 3 horas, você consome aproximadamente o que já tem de hábito, se pesa em jejum pela manhã e o algoritmo calibra seus superávits e déficits automaticamente.',
      faq_2_q: 'Como o app sabe a diferença entre água e gordura?',
      faq_2_a: 'Tecido adiposo e muscular possuem inércia biológica: é metabolicamente impossível para o corpo humano sintetizar 1,5 kg de gordura pura em 24 horas. O filtro de regressão com amortecimento de outliers identifica variações bruscas como retenção hídrica transitória (sódio, glicogênio ou inflamação), ignorando-as no cálculo da taxa real de ganho.',
      faq_3_q: 'Por que o déficit do minicut nunca passa de 650 kcal?',
      faq_3_a: 'A literatura científica demonstra que déficits agressivos demais (acima de 750–1000 kcal/dia) em atletas treinados aumentam dramaticamente a oxidação de aminoácidos musculares e suprimem a tireoide. O teto rígido de 650 kcal do Masscience garante que 99.9% da massa muscular construída no bulk seja preservada durante o minicut.',
      faq_4_q: 'O aplicativo funciona em português, inglês e espanhol?',
      faq_4_a: 'Sim! O Masscience possui suporte i18n nativo de primeira classe para Português (Brasil), Inglês e Espanhol. Você pode escolher seu idioma preferido logo no primeiro passo do onboarding ou alternar nas Configurações a qualquer momento.',
      faq_5_q: 'Meus dados corporais vão para algum servidor na internet?',
      faq_5_a: 'Não. O Masscience é 100% offline-first. Seus pesos, estimativas de gordura, fotos e notas ficam exclusivamente no armazenamento local seguro do seu próprio navegador ou aparelho. Você pode exportar backups completos em formato JSON a qualquer instante.',
      cta_final_title: 'Pronto para Conquistar o Melhor Físico da Sua Vida?',
      cta_final_subtitle: 'Livre-se da ansiedade das balanças de comida. Deixe a matemática cuidar do controle calórico enquanto você foca no treino pesado.',
      cta_final_btn: 'Abrir o Masscience Agora',
      cta_final_sub: 'Disponível em qualquer dispositivo • Sem necessidade de cadastro',
      footer_desc: 'O ecossistema adaptativo e científico para controle contínuo de hipertrofia e recomposição corporal.',
      footer_col_app: 'Aplicativo',
      footer_open_web: 'Abrir Web App',
      footer_try_demo: 'Testar com Dados Demo',
      footer_col_science: 'Ciência & Código',
      footer_col_legal: 'Transparência',
      footer_disclaimer: 'O Masscience é uma ferramenta matemática de modelagem fisiológica e não substitui acompanhamento médico ou nutricional individualizado.',
    },
    en: {
      nav_features: 'Features',
      nav_how: 'How It Works',
      nav_sim: 'Simulator',
      nav_science: 'Science',
      nav_faq: 'FAQ',
      btn_open_app: 'Open App',
      hero_badge: 'Cybernetic Algorithm v2.4 • No food logging required',
      hero_title_1: 'Build Muscle Mass on',
      hero_title_gradient: 'Pure Autopilot.',
      hero_subtitle: 'The first closed-loop adaptive control system that calibrates calories and minicuts from your real biological response. Filter out sodium, water, and creatine spikes while building lean tissue with clinical precision.',
      hero_cta_primary: 'Start My Free Cycle',
      hero_cta_secondary: 'Interactive Simulator',
      metric_correlation: 'Trend Correlation',
      metric_deficit_cap: 'Safe Minicut Deficit Cap',
      metric_muscle_preserved: 'Muscle Mass Preserved',
      metric_privacy: 'Private & Offline-First',
      mock_status_on_track: 'ON TRACK (+0.19 kg/wk)',
      mock_rec_title: 'Calorie Recommendation',
      badge_why: 'WHY TRADITIONAL APPS FAIL',
      title_why: 'The Gap Between the Scale and Real Muscle',
      subtitle_why: 'You ate pizza on Saturday and woke up Monday +1.5 kg heavier. Was it fat? No. It was transient fluid retention from sodium and glycogen.',
      comp_old_badge: 'THE TRADITIONAL & OBSESSIVE WAY',
      comp_old_title: 'Neurotic Logging & Panic',
      comp_old_1_title: 'Weighing every single lettuce leaf',
      comp_old_1_desc: 'You spend 30 minutes every day scanning food barcodes that carry up to 20% legal error margin on nutrition labels.',
      comp_old_2_title: 'Static calculators from 1919',
      comp_old_2_desc: 'Formulas like Harris-Benedict assume your daily energy expenditure is static, ignoring metabolic adaptation.',
      comp_old_3_title: 'Scale weight panic',
      comp_old_3_desc: 'Any water spike or heavy leg workout causes standard apps to slash calories, sabotaging muscle protein synthesis.',
      comp_old_4_title: 'Endless minicuts',
      comp_old_4_desc: 'Without rigorous termination targets, you waste valuable bulking weeks or burn through hard-earned lean muscle.',
      comp_new_badge: 'THE MASSCIENCE CYBERNETIC WAY',
      comp_new_title: 'Adaptive Closed-Loop Control',
      comp_new_1_title: 'Your body is the ultimate food scale',
      comp_new_1_desc: 'Instead of weighing chicken, you log morning weights and the model infers your latent TDEE continuously.',
      comp_new_2_title: 'Decoupling transient fluid noise',
      comp_new_2_desc: 'Tissue inertia filtering dampens pizza, creatine, DOMS, and acute cortisol spikes without mutating raw scale records.',
      comp_new_3_title: 'Damped calorie adjustments',
      comp_new_3_desc: 'The controller uses deadband thresholds and 7-day cooldowns. No erratic swings: only smooth, honest micro-adjustments.',
      comp_new_4_title: '21-day minicuts with 650 kcal cap',
      comp_new_4_desc: 'Strict target to return to cycle starting BF with 99.9% lean mass preservation, automatically advancing to the next bulk.',
      badge_sim: 'LIVE INTERACTIVE DEMO',
      title_sim: 'Watch the Algorithm Dampen Fluid Spikes',
      subtitle_sim: 'Simulate a real-world event: you were on track and had a high sodium meal or intense leg day. See how Masscience protects your calories:',
      sim_weight_label: 'Athlete Baseline Weight:',
      sim_event_label: 'Select the Atypical Event:',
      sim_chart_title: 'Masscience Algorithm Response',
      legend_raw: 'Raw Scale Reading',
      legend_filtered: 'Masscience Filtered Trend',
      res_measured_jump: 'Scale Jump',
      res_tissue_trend: 'Trend Drift',
      res_controller_decision: 'Controller Decision',
      res_keep_calories: 'Maintain Calories Stable (No Panic)',
      badge_features: 'ELITE FEATURES',
      title_features: 'Built for Athletes Who Demand Real Progress',
      subtitle_features: 'Every line of Masscience code was architected to solve real human physiology challenges and remove mental friction.',
      feat_1_title: 'Nutrition Without Food Logging',
      feat_1_desc: 'Stop scanning barcodes. Based on your actual gain rate and adaptive expenditure, the app recommends practical tweaks like "+1 tbsp peanut butter or +1 banana".',
      feat_2_title: 'Minicuts That Stay "Mini"',
      feat_2_desc: 'Non-negotiable goal of returning to cycle baseline body fat within ~21 days, capped at 650 kcal/day deficit to shield your muscle gains.',
      feat_3_title: 'Continuous Infinite Cycling',
      feat_3_desc: 'Finished your minicut? Masscience calculates your new baseline and loops directly into the next Lean Bulk (Cycle #2, #3, #N) automatically.',
      feat_4_title: 'Physiological Check-in Tags',
      feat_4_desc: '1-tap toggles for poor sleep, heavy leg day DOMS, creatine loading, and free meals. The filter dampens water noise without altering raw history.',
      feat_5_title: 'Monte Carlo Probabilistic Projections',
      feat_5_desc: 'Powered by 800+ stochastic simulations, view scientifically honest probability intervals for weight and fat mass at cycle completion.',
      feat_6_title: '4 Mobile Tabs & 100% Offline',
      feat_6_desc: 'Modernized 4-tab thumb-friendly interface. Your data belongs to you: stored locally on your device with no trackers or intrusive ads.',
      badge_science: 'MATHEMATICAL RIGOR',
      title_science: 'Biomedical Engineering Turned into Code',
      desc_science_1: 'While other apps rely on naive assumptions, Masscience implements compartmental physiology (Forbes / P-Ratio), tissue inertia dampening, and deadband closed-loop control.',
      desc_science_2: 'In extensive 180-day physiological benchmark tests against 6-compartment ground truth models, the v2.4 engine demonstrated a 0.9942 trend correlation and 100% minicut target precision.',
      badge_faq: 'HAVE QUESTIONS?',
      title_faq: 'Frequently Asked Questions',
      subtitle_faq: 'Everything you need to know about how Masscience works in practice.',
      faq_1_q: 'Do I need to weigh all my food in the app?',
      faq_1_a: 'No! That is the fundamental premise of Masscience. Instead of weighing 150g rice and 120g chicken every 3 hours, you eat intuitively or by habit, log morning weigh-ins, and the algorithm tunes your energy balance automatically.',
      faq_2_q: 'How does the app tell water from fat?',
      faq_2_a: 'Adipose and muscle tissue have metabolic inertia: it is biologically impossible for a human to synthesize 1.5 kg of pure fat in 24 hours. The robust regression filter identifies acute jumps as transient water, keeping your trend smooth.',
      faq_3_q: 'Why is minicut deficit strictly capped at 650 kcal?',
      faq_3_a: 'Scientific research shows deficits larger than 750-1000 kcal/day in trained lifters dramatically increase lean muscle oxidation and downregulate thyroid function. Our 650 kcal hard ceiling ensures 99.9% muscle retention.',
      faq_4_q: 'Does the app support Portuguese, English, and Spanish?',
      faq_4_a: 'Yes! Masscience includes first-class native internationalization for English, Portuguese (Brazil), and Spanish. Choose your language during onboarding or toggle anytime in Settings.',
      faq_5_q: 'Are my body metrics sent to external servers?',
      faq_5_a: 'No. Masscience is 100% offline-first. Your weight logs, body fat estimates, photos, and history reside strictly inside your device. You can export complete JSON backups anytime.',
      cta_final_title: 'Ready to Achieve Your Best Physique Ever?',
      cta_final_subtitle: 'Ditch the kitchen scale obsession. Let mathematics handle energy control while you focus on lifting heavy.',
      cta_final_btn: 'Open Masscience Now',
      cta_final_sub: 'Works on any device • No registration required',
      footer_desc: 'The adaptive, scientific ecosystem for continuous hypertrophy and body recomposition control.',
      footer_col_app: 'Application',
      footer_open_web: 'Open Web App',
      footer_try_demo: 'Try Demo Data',
      footer_col_science: 'Science & Code',
      footer_col_legal: 'Transparency',
      footer_disclaimer: 'Masscience is a mathematical physiological modeling system and does not replace personalized medical or nutritional advice.',
    }
  };

  let currentLang = localStorage.getItem('masscience_landing_lang') || 'pt';

  function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('masscience_landing_lang', lang);
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';

    // Update Flag & Code Button
    const flagEl = document.getElementById('current-flag');
    const codeEl = document.getElementById('current-lang-code');
    if (flagEl) flagEl.textContent = lang === 'pt' ? '🇧🇷' : '🇺🇸';
    if (codeEl) codeEl.textContent = lang.toUpperCase();

    // Replace all data-i18n elements
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18n[lang] && i18n[lang][key]) {
        el.textContent = i18n[lang][key];
      }
    });

    // Update active simulator event explanation
    updateSimulatorEventExplanation();
  }

  const langToggleBtn = document.getElementById('lang-toggle-btn');
  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      const nextLang = currentLang === 'pt' ? 'en' : 'pt';
      applyLanguage(nextLang);
    });
  }

  // =========================================================================
  // 2. Interactive Simulator (HTML5 Canvas)
  // =========================================================================
  const canvas = document.getElementById('interactive-sim-canvas');
  const weightSlider = document.getElementById('sim-starting-weight');
  const weightValDisplay = document.getElementById('sim-weight-val');
  const eventButtons = document.querySelectorAll('.event-btn');
  const spikeValDisplay = document.getElementById('res-spike-val');
  const trendValDisplay = document.getElementById('res-trend-val');
  const eventDescEl = document.getElementById('sim-event-desc');

  let simBaseWeight = 74.0;
  let simSpikeAmount = 1.6;
  let simEventType = 'sodium';

  function updateSimulatorEventExplanation() {
    if (!eventDescEl) return;
    if (simEventType === 'sodium') {
      eventDescEl.innerHTML = currentLang === 'pt'
        ? '🧂 <strong>Refeição livre:</strong> Retenção osmótica transitória de água. O app comum acha que você engordou 1,6 kg de gordura e corta 400 kcal. O Masscience amortece 85% do pico.'
        : '🧂 <strong>Free meal:</strong> Transient osmotic fluid retention. Standard apps assume you gained 1.6 kg of fat and cut 400 kcal. Masscience dampens 85% of this spike.';
    } else if (simEventType === 'doms') {
      eventDescEl.innerHTML = currentLang === 'pt'
        ? '🏋️ <strong>Treino pesado de pernas:</strong> Microlesões musculares atraem fluido inflamatório (+1,2 kg por 48h). O filtro cibernético desconsidera essa água no TDEE.'
        : '🏋️ <strong>Heavy leg day:</strong> Muscle damage draws inflammatory fluid (+1.2 kg for 48h). Our cybernetic filter ignores this temporary water in TDEE calculation.';
    } else if (simEventType === 'creatine') {
      eventDescEl.innerHTML = currentLang === 'pt'
        ? '💊 <strong>Saturação de creatina:</strong> Aumento da hidratação celular intramuscular (+1,8 kg). Não é gordura: o controlador mantém o superávit anabólico intacto.'
        : '💊 <strong>Creatine saturation:</strong> Increased intracellular hydration (+1.8 kg). This is not fat: the controller keeps your anabolic surplus intact.';
    } else {
      eventDescEl.innerHTML = currentLang === 'pt'
        ? '✨ <strong>Semana Estável:</strong> Ganho linear limpo de +0,20 kg/sem. Ambos os sinais coincidem perfeitamente.'
        : '✨ <strong>Stable Week:</strong> Clean linear gain of +0.20 kg/week. Both signals align smoothly.';
    }
  }

  function drawSimulation() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 30; y < height - 20; y += 40) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(width - 20, y);
      ctx.stroke();
    }

    // Days 0 to 13 (14 days)
    const days = 14;
    const paddingX = 45;
    const paddingY = 30;
    const graphW = width - paddingX - 25;
    const graphH = height - paddingY - 35;

    // Generate Points
    const trueRatePerDay = 0.20 / 7; // +0.20 kg/week
    const pointsRaw = [];
    const pointsTrend = [];

    // Base weight variation
    for (let d = 0; d < days; d++) {
      const trueGain = d * trueRatePerDay;
      let noise = (Math.sin(d * 1.8) * 0.18) + (Math.cos(d * 0.9) * 0.12);

      // Day 7: Acute Spike
      let spike = 0;
      if (d === 7) {
        spike = simSpikeAmount;
      } else if (d === 8) {
        spike = simSpikeAmount * 0.6; // decaying
      } else if (d === 9) {
        spike = simSpikeAmount * 0.2;
      }

      const rawWeight = simBaseWeight + trueGain + noise + spike;
      // Masscience Trend: absorbs only 15% of the spike
      const dampedSpike = spike * 0.15;
      const trendWeight = simBaseWeight + trueGain + (noise * 0.25) + dampedSpike;

      pointsRaw.push(rawWeight);
      pointsTrend.push(trendWeight);
    }

    // Y Scale
    const minW = simBaseWeight - 0.5;
    const maxW = simBaseWeight + Math.max(simSpikeAmount + 0.8, 2.5);

    function getX(i) {
      return paddingX + (i / (days - 1)) * graphW;
    }

    function getY(val) {
      return height - paddingY - ((val - minW) / (maxW - minW)) * graphH;
    }

    // Draw Y axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${minW.toFixed(1)} kg`, paddingX - 8, getY(minW) + 4);
    ctx.fillText(`${((minW + maxW) / 2).toFixed(1)} kg`, paddingX - 8, getY((minW + maxW) / 2) + 4);
    ctx.fillText(`${maxW.toFixed(1)} kg`, paddingX - 8, getY(maxW) + 4);

    // Draw X axis labels (Days)
    ctx.textAlign = 'center';
    for (let d = 0; d < days; d += 2) {
      const label = currentLang === 'pt' ? `D${d + 1}` : `D${d + 1}`;
      ctx.fillText(label, getX(d), height - 10);
    }

    // 1. Draw Confidence Band around Trend Line
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.beginPath();
    for (let i = 0; i < days; i++) {
      const x = getX(i);
      const y = getY(pointsTrend[i] + 0.25);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = days - 1; i >= 0; i--) {
      const x = getX(i);
      const y = getY(pointsTrend[i] - 0.25);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // 2. Draw Raw Scale Line (Reddish / Gray dashed)
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    pointsRaw.forEach((val, i) => {
      const x = getX(i);
      const y = getY(val);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Raw points
    pointsRaw.forEach((val, i) => {
      const x = getX(i);
      const y = getY(val);
      ctx.fillStyle = i === 7 ? '#f87171' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(x, y, i === 7 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 3. Draw Masscience Smooth Trend Line (Neon Cyan Glow)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    pointsTrend.forEach((val, i) => {
      const x = getX(i);
      const y = getY(val);
      if (i === 0) ctx.moveTo(x, y);
      else {
        // smooth bezier
        const prevX = getX(i - 1);
        const prevY = getY(pointsTrend[i - 1]);
        const cpX = (prevX + x) / 2;
        ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
      }
    });
    ctx.stroke();

    // Latest trend point
    const lastX = getX(days - 1);
    const lastY = getY(pointsTrend[days - 1]);
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Update Result Metrics display
    if (spikeValDisplay) spikeValDisplay.textContent = `+${simSpikeAmount.toFixed(2)} kg`;
    if (trendValDisplay) trendValDisplay.textContent = `+${(simSpikeAmount * 0.15).toFixed(2)} kg`;
  }

  // Weight Slider Event
  if (weightSlider) {
    weightSlider.addEventListener('input', (e) => {
      simBaseWeight = parseFloat(e.target.value);
      if (weightValDisplay) weightValDisplay.textContent = `${simBaseWeight.toFixed(1)} kg`;
      drawSimulation();
    });
  }

  // Event Buttons
  eventButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      eventButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      simSpikeAmount = parseFloat(btn.getAttribute('data-spike'));
      simEventType = btn.getAttribute('data-type');

      updateSimulatorEventExplanation();
      drawSimulation();
    });
  });

  // Initial draw of simulation
  drawSimulation();

  // =========================================================================
  // 3. Accordion (FAQ)
  // =========================================================================
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement;
      const isOpen = item.classList.contains('active');

      // Close all other items
      document.querySelectorAll('.accordion-item').forEach(otherItem => {
        otherItem.classList.remove('active');
        otherItem.querySelector('.accordion-header')?.setAttribute('aria-expanded', 'false');
      });

      if (!isOpen) {
        item.classList.add('active');
        header.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // =========================================================================
  // 4. Header Glassmorphism Scroll & Mobile Drawer
  // =========================================================================
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  });

  const mobileToggle = document.getElementById('mobile-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      mobileDrawer.classList.toggle('active');
    });

    mobileDrawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('active');
      });
    });
  }

  // Initialize Language
  applyLanguage(currentLang);
});
