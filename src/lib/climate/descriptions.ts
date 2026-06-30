// Plain-language, first-principles explanation for every climate indicator, plus
// a data-driven statistical reading. Written for laypeople / ward officials:
// what the indicator physically is, why it matters for Tulsipur, and what the
// actual numbers (baseline, trend, seasonal high/low) mean in everyday terms.
import { toNe, MONTHS_NE } from "./labels";

// romanized Bikram Sambat months for the English view (Gregorian → dominant BS)
export const MONTHS_EN = ["Magh", "Falgun", "Chaitra", "Baisakh", "Jestha", "Asar", "Srawan", "Bhadra", "Asoj", "Kartik", "Mangsir", "Poush"];

// English names for every indicator (ids are stable across core + ERA5-Land).
export const VAR_LABEL_EN: Record<string, string> = {
  temp: "Temperature (mean)", tmax: "Maximum temperature", tmin: "Minimum temperature", precip: "Rainfall (total)",
  rh: "Relative humidity", pressure: "Air pressure", cloud: "Cloud cover", wind: "Wind speed",
  srad: "Solar radiation", et0: "Evapotranspiration (ET₀)",
  dewpoint: "Dew point", skin_temp: "Surface (skin) temperature",
  soil_t1: "Soil temp 0–7 cm", soil_t2: "Soil temp 7–28 cm", soil_t3: "Soil temp 28–100 cm", soil_t4: "Soil temp 1–2.5 m",
  soil_m1: "Soil moisture 0–7 cm", soil_m2: "Soil moisture 7–28 cm", soil_m3: "Soil moisture 28–100 cm", soil_m4: "Soil moisture 1–2.5 m",
  snow_depth: "Snow depth (w.e.)", snow_cover: "Snow cover", lai_high: "Leaf-area index (high veg.)", lai_low: "Leaf-area index (low veg.)",
  albedo: "Surface albedo", msl: "Sea-level pressure", wind100: "Wind speed 100 m", tcwv: "Column water vapour", cape: "CAPE (storm energy)",
};
export const VAR_SHORT_EN: Record<string, string> = {
  temp: "Temp", tmax: "Max temp", tmin: "Min temp", precip: "Rain", rh: "Humidity", pressure: "Pressure",
  cloud: "Cloud", wind: "Wind", srad: "Radiation", et0: "ET₀",
};
const UNIT_MAP: Record<string, string> = { "°से": "°C", "मि.मि.": "mm", "कि.मि./घ.": "km/h", "%आयतन": "%vol", "से.मि.": "cm" };
export const unitTr = (u: string, lang: "ne" | "en") => (lang === "en" ? (UNIT_MAP[u] || u) : u);

// category labels in English
export const CAT_EN: Record<string, string> = {
  core: "Core weather", soil: "Soil (temp & moisture)", snow: "Snow", veg: "Vegetation", land: "Land surface", atmos: "Atmosphere (extra)",
};

export type VarDesc = {
  what: string;  // what it physically measures (first principles)
  why: string;   // why it matters for Tulsipur (agriculture / health / water / hazard)
  up: string;    // what a RISING long-term trend implies (human consequence)
  down: string;  // what a FALLING long-term trend implies
};

export const VAR_DESC: Record<string, VarDesc> = {
  // ── core (Open-Meteo ERA5 daily) ──
  temp: {
    what: "हावाको दैनिक औसत तापक्रम — जमिनबाट करिब दुई मिटर माथिको हावा कति तातो वा चिसो छ भन्ने मापन ।",
    why: "तापक्रमले बाली रोप्ने–भित्र्याउने समय, खानेपानीको माग, र मानिसको आराम–स्वास्थ्य सबै निर्धारण गर्छ ।",
    up: "जसले गर्मी लम्बिने, सिँचाइ–माग बढ्ने र ताप–तनाव बढ्ने सङ्केत गर्छ",
    down: "जसले चिस्यान बढेको देखाउँछ",
  },
  tmax: {
    what: "दिनको सबैभन्दा तातो समयको तापक्रम (प्रायः मध्याह्नपछि) को औसत ।",
    why: "उच्चतम तापक्रमले लु, बालीमा ताप–धक्का र विद्युत्–पानीको चरम माग निर्धारण गर्छ ।",
    up: "जसले तातो–लहर र लु जोखिम बढाउँछ",
    down: "जसले दिउँसोको तातोपन घटेको देखाउँछ",
  },
  tmin: {
    what: "रातको सबैभन्दा चिसो समयको तापक्रमको औसत ।",
    why: "न्यूनतम तापक्रमले हिउँदे शीत–तुषारो, बाली–रोग र चिसोजन्य स्वास्थ्य–समस्या सङ्केत गर्छ ।",
    up: "जसले रात न्यानो भएको — global warming कै स्थानीय छाप देखाउँछ",
    down: "जसले हिउँदे चिसो/तुषारो जोखिम बढाउँछ",
  },
  precip: {
    what: "एक वर्षमा खस्ने कुल पानी (वर्षा) मिलिमिटरमा — एक वर्ग मिटरमा कति लिटर पानी पर्‍यो भन्ने ।",
    why: "वर्षा नै कृषि, खानेपानी, भूमिगत जल र बाढी–पहिरो सबैको मूल स्रोत हो ।",
    up: "जसले भारी–वर्षा र बाढी जोखिम बढ्ने सङ्केत गर्छ",
    down: "जसले अनावृष्टि–खडेरी र सिँचाइ–सङ्कट निम्त्याउन सक्छ",
  },
  rh: {
    what: "सापेक्षिक आर्द्रता — हावाले बोक्न सक्ने अधिकतम जलवाष्पको तुलनामा हाल कति प्रतिशत बोकेको छ ।",
    why: "आर्द्रताले उखुमपन, बाली–रोग (ढुसी), र मानिसको पसिना–शीतलनलाई असर गर्छ ।",
    up: "जसले उखुमपन र ढुसीजन्य बाली–रोग बढाउँछ",
    down: "जसले सुक्खापन र वाष्पीकरण बढाउँछ",
  },
  pressure: {
    what: "सतहमा हावाको स्तम्भले पार्ने चाप — मौसम–प्रणाली (आँधी/सफा) को आधारभूत सूचक ।",
    why: "चाप घट्नु प्रायः आँधी–वर्षाको र बढ्नु सफा–स्थिर मौसमको सङ्केत हो ।",
    up: "जसले स्थिर–सफा मौसमको प्रवृत्ति देखाउँछ",
    down: "जसले अस्थिर–वर्षायुक्त मौसम बढेको देखाउँछ",
  },
  cloud: {
    what: "आकाश औसतमा कति प्रतिशत बादलले ढाकिएको हुन्छ भन्ने मापन ।",
    why: "बादलले सौर्य–ऊर्जा, दिन–रातको तापक्रम–अन्तर र वर्षाको सम्भावना निर्धारण गर्छ ।",
    up: "जसले सौर्य–विकिरण घटाउँछ र वर्षा–सम्भावना बढाउँछ",
    down: "जसले बढी घमाइलो–सुक्खा दिन देखाउँछ",
  },
  wind: {
    what: "जमिनबाट १० मिटर माथिको दैनिक अधिकतम हावाको गति ।",
    why: "हावाले वाष्पीकरण, परागसेचन, आगलागी–फैलावट र पवन–ऊर्जा सम्भावना निर्धारण गर्छ ।",
    up: "जसले वाष्पीकरण र आँधी–क्षति जोखिम बढाउँछ",
    down: "जसले शान्त–वायु अवस्था देखाउँछ",
  },
  srad: {
    what: "सूर्यबाट सतहमा पुग्ने ऊर्जा — दैनिक कति मेगाजुल प्रति वर्ग मिटर ।",
    why: "सौर्य–विकिरणले बालीको प्रकाश–संश्लेषण, वाष्पीकरण र सौर्य–ऊर्जा सम्भावना निर्धारण गर्छ ।",
    up: "जसले सौर्य–ऊर्जा सम्भावना र वाष्पीकरण बढाउँछ",
    down: "जसले बढी बादल/धुम्मियुक्त अवस्था देखाउँछ",
  },
  et0: {
    what: "सन्दर्भ वाष्पीकरण–उत्स्वेदन (ET₀) — माटो र बिरुवाबाट हावामा कति पानी उड्छ भन्ने अनुमान ।",
    why: "ET₀ ले बालीको पानी–माग र सिँचाइ–तालिका सीधै निर्धारण गर्छ ।",
    up: "जसले सिँचाइ–माग र पानी–तनाव बढाउँछ",
    down: "जसले पानी–माग घटेको देखाउँछ",
  },
  // ── Copernicus ERA5-Land ──
  dewpoint: {
    what: "हिमांक बिन्दु — हावा कति तापक्रममा पुग्दा जलवाष्प सङ्घनन (शीत/तुषारो) हुन थाल्छ ।",
    why: "उच्च हिमांक बिन्दु = हावामा बढी आर्द्रता; यसले उखुमपन र वर्षा–सम्भावनाको साँचो मापन दिन्छ ।",
    up: "जसले हावामा आर्द्रता बढेको — बढी उखुम र वर्षा–सम्भावना देखाउँछ",
    down: "जसले सुक्खा हावा देखाउँछ",
  },
  skin_temp: {
    what: "जमिनको सतहको आफ्नै तापक्रम (हावाको होइन) — सूर्यले तताएको माटो/वनस्पतिको सतह ।",
    why: "सतह–तापक्रमले माटो सुक्ने दर, सहरी ताप र वाष्पीकरण सीधै निर्धारण गर्छ ।",
    up: "जसले सतह तातिँदै गएको — माटो छिटो सुक्ने देखाउँछ",
    down: "जसले शीतल सतह देखाउँछ",
  },
  soil_t1: {
    what: "माटोको सतही तह (०–७ से.मि.) को तापक्रम — बीउ उम्रने क्षेत्र ।",
    why: "बीउ उम्रन, अङ्कुरण र सतही जैविक–क्रियाका लागि यही तह निर्णायक हुन्छ ।",
    up: "जसले छिटो अङ्कुरण तर सतही सुक्खापन पनि बढाउँछ",
    down: "जसले चिसो माटो — ढिलो अङ्कुरण देखाउँछ",
  },
  soil_t2: {
    what: "माटोको जरा–तह (७–२८ से.मि.) को तापक्रम — अधिकांश बालीको मुख्य जरा–क्षेत्र ।",
    why: "जराको वृद्धि र पोषक–शोषण यही तहको न्यानोपनमा निर्भर हुन्छ ।",
    up: "जसले जरा–क्षेत्र न्यानो भएको देखाउँछ",
    down: "जसले जरा–क्षेत्र चिसो भएको देखाउँछ",
  },
  soil_t3: {
    what: "माटोको गहिरो तह (२८–१०० से.मि.) को तापक्रम ।",
    why: "गहिरो जरा भएका बहुवर्षीय बाली/रुखका लागि यो तह महत्त्वपूर्ण छ ।",
    up: "जसले गहिरो माटो बिस्तारै तातिँदै गएको देखाउँछ",
    down: "जसले गहिरो माटो चिसिँदै गएको देखाउँछ",
  },
  soil_t4: {
    what: "सबैभन्दा गहिरो माटो–तह (१–२.५ मिटर) को तापक्रम — मौसमी उतार–चढाव न्यून ।",
    why: "यो तहले दीर्घकालीन भू–तापीय भण्डारण र भूमिगत जलको तापक्रम झल्काउँछ ।",
    up: "जसले दीर्घकालीन भू–ताप वृद्धि देखाउँछ",
    down: "जसले दीर्घकालीन भू–ताप ह्रास देखाउँछ",
  },
  soil_m1: {
    what: "सतही माटो (०–७ से.मि.) मा रहेको पानीको आयतन प्रतिशत ।",
    why: "बीउ उम्रने र सतही सुक्खा–तनावको प्रत्यक्ष सूचक — खडेरी–निगरानीको आधार ।",
    up: "जसले सतही माटो ओसिलो — अङ्कुरणमैत्री भएको देखाउँछ",
    down: "जसले सतही खडेरी–तनाव बढेको देखाउँछ",
  },
  soil_m2: {
    what: "जरा–तह (७–२८ से.मि.) मा रहेको माटो–आर्द्रता ।",
    why: "बालीले वास्तवमा पिउने पानी यहीँबाट आउँछ — सिँचाइ–निर्णयको मूल आधार ।",
    up: "जसले बालीलाई पुग्ने जल–भण्डार बढेको देखाउँछ",
    down: "जसले सिँचाइ–माग र बाली–तनाव बढाउँछ",
  },
  soil_m3: {
    what: "गहिरो तह (२८–१०० से.मि.) को माटो–आर्द्रता ।",
    why: "लामो सुक्खामा बालीलाई टिकाउने जल–भण्डार यही तहले राख्छ ।",
    up: "जसले गहिरो जल–भण्डार सुदृढ भएको देखाउँछ",
    down: "जसले गहिरो जल–भण्डार रित्तिँदै गएको देखाउँछ",
  },
  soil_m4: {
    what: "सबैभन्दा गहिरो तह (१–२.५ मिटर) को माटो–आर्द्रता ।",
    why: "भूमिगत जल–पुनर्भरण र बहुवर्षीय वनस्पतिको दीर्घकालीन जल–स्रोत झल्काउँछ ।",
    up: "जसले भूमिगत जल–भण्डार बलियो भएको देखाउँछ",
    down: "जसले दीर्घकालीन जल–भण्डार घट्दै गएको — गम्भीर सङ्केत",
  },
  snow_depth: {
    what: "जमिनमा जमेको हिउँको जल–समतुल्य गहिराइ (पगाल्दा कति पानी हुन्छ) ।",
    why: "उच्च भेगको हिउँ वसन्त–ग्रीष्ममा बिस्तारै पग्लेर नदी–सिँचाइ टिकाउँछ ।",
    up: "जसले हिउँ–भण्डार बढेको देखाउँछ",
    down: "जसले हिउँ–भण्डार घट्दै — वसन्ते जल–प्रवाह घट्ने सङ्केत",
  },
  snow_cover: {
    what: "क्षेत्रको कति प्रतिशत भाग हिउँले ढाकिएको हुन्छ भन्ने ।",
    why: "हिउँ–आवरणले सतहको परावर्तन, माटो–न्यानोपन र वसन्ते जल–आपूर्ति निर्धारण गर्छ ।",
    up: "जसले हिउँ–आवरण बढेको देखाउँछ",
    down: "जसले हिउँ–आवरण घट्दै गएको देखाउँछ",
  },
  lai_high: {
    what: "उच्च वनस्पति (रुख) को पात–घनत्व सूचक — प्रति वर्ग मिटर जमिनमा कति वर्ग मिटर पात ।",
    why: "रुखको पात–घनत्वले वन–स्वास्थ्य, छहारी, कार्बन–शोषण र जैविक–विविधता झल्काउँछ ।",
    up: "जसले वन–आवरण/हरियाली बढेको देखाउँछ",
    down: "जसले वन–ह्रास वा सुक्खा–तनाव देखाउँछ",
  },
  lai_low: {
    what: "न्यून वनस्पति (घाँस, बाली, झाडी) को पात–घनत्व सूचक ।",
    why: "चरन, बाली–वृद्धि र भू–आवरणको हरियाली यसैले झल्काउँछ ।",
    up: "जसले घाँस/बाली–हरियाली बढेको देखाउँछ",
    down: "जसले हरियाली घटेको देखाउँछ",
  },
  albedo: {
    what: "सतह परावर्तन (Albedo) — सतहले सूर्यको कति प्रतिशत प्रकाश फिर्ता फर्काउँछ ।",
    why: "उच्च परावर्तन (हिउँ/उजाड) ले ताप घटाउँछ; न्यून (वन/पानी) ले ताप सोस्छ — भू–उपयोग परिवर्तनको सूचक ।",
    up: "जसले सतह उज्यालो (हिउँ/उजाड/नाङ्गो) हुँदै गएको देखाउँछ",
    down: "जसले सतह गाढा (वन/बाली) हुँदै गएको देखाउँछ",
  },
  msl: {
    what: "समुद्र–सतहमा परिणत गरिएको वायुचाप — ठाउँ–ठाउँको उचाइ हटाएर मौसम–प्रणाली तुलना गर्ने मानक ।",
    why: "न्यून–चाप प्रणाली आँधी–मनसुनसँग, उच्च–चाप सफा–स्थिर मौसमसँग जोडिन्छ ।",
    up: "जसले उच्च–चाप/स्थिर मौसमको प्रवृत्ति देखाउँछ",
    down: "जसले न्यून–चाप/वर्षायुक्त प्रणाली बढेको देखाउँछ",
  },
  wind100: {
    what: "जमिनबाट १०० मिटर माथिको हावाको गति — पवन–टर्बाइनको उचाइ ।",
    why: "पवन–ऊर्जा सम्भाव्यता आकलनका लागि यही उचाइको हावा निर्णायक हुन्छ ।",
    up: "जसले पवन–ऊर्जा सम्भावना बढेको देखाउँछ",
    down: "जसले पवन–ऊर्जा सम्भावना घटेको देखाउँछ",
  },
  tcwv: {
    what: "वायुस्तम्भ जलवाष्प — तपाईंको टाउकोमाथिको पूरै हावा–स्तम्भमा रहेको कुल पानी (kg/m²) ।",
    why: "यो जति बढी, त्यति भारी–वर्षाको इन्धन बढी — मनसुन–तीव्रताको प्रत्यक्ष सूचक ।",
    up: "जसले वायुमण्डलमा आर्द्रता–इन्धन बढेको — भारी वर्षा सम्भावना देखाउँछ",
    down: "जसले वायुमण्डल सुक्खा भएको देखाउँछ",
  },
  cape: {
    what: "संवहनीय उपलब्ध स्थितिज ऊर्जा (CAPE) — वायुमण्डल कति 'विस्फोटक' छ, चट्याङ–आँधीको इन्धन ।",
    why: "उच्च CAPE = प्रचण्ड गर्जन–आँधी, असिना र चट्याङको बढ्दो सम्भावना ।",
    up: "जसले प्रचण्ड आँधी–चट्याङ जोखिम बढेको देखाउँछ",
    down: "जसले स्थिर वायुमण्डल देखाउँछ",
  },
};

// English mirror of VAR_DESC — same meaning, plain English for laypeople.
export const VAR_DESC_EN: Record<string, VarDesc> = {
  temp: { what: "The daily average air temperature about two metres above the ground — how warm or cold the air is.", why: "Temperature governs planting and harvest timing, water demand, and human comfort and health.", up: "which signals longer heat, higher irrigation demand and more heat stress", down: "which indicates a cooling tendency" },
  tmax: { what: "The average of the hottest part of the day (usually early afternoon).", why: "Daytime highs drive heatwaves, crop heat-shock and peak power and water demand.", up: "raising heatwave and sunstroke risk", down: "showing daytime heat easing" },
  tmin: { what: "The average of the coldest part of the night.", why: "Night-time lows govern winter frost, crop disease and cold-related health issues.", up: "warmer nights — the local fingerprint of global warming", down: "raising winter cold and frost risk" },
  precip: { what: "Total rainfall in a year in millimetres — how many litres fell per square metre.", why: "Rain is the source of agriculture, drinking water, groundwater and flood/landslide risk.", up: "signalling heavier rainfall and flood risk", down: "which can bring drought and irrigation shortfall" },
  rh: { what: "Relative humidity — what percent of the maximum moisture the air can hold it currently holds.", why: "Humidity affects mugginess, fungal crop disease, and how well people cool by sweating.", up: "increasing mugginess and fungal crop disease", down: "increasing dryness and evaporation" },
  pressure: { what: "Surface air pressure — the basic indicator of weather systems (storm vs clear).", why: "Falling pressure usually signals storms and rain; rising pressure clear, settled weather.", up: "showing a tendency toward settled, clear weather", down: "showing more unsettled, rainy weather" },
  cloud: { what: "What percent of the sky is covered by cloud on average.", why: "Cloud governs solar energy, the day–night temperature gap, and rain likelihood.", up: "reducing solar radiation and raising rain chances", down: "showing more sunny, dry days" },
  wind: { what: "The daily maximum wind speed at 10 m above the ground.", why: "Wind drives evaporation, pollination, fire spread and wind-energy potential.", up: "raising evaporation and storm-damage risk", down: "showing calmer conditions" },
  srad: { what: "Energy reaching the surface from the sun — megajoules per square metre per day.", why: "Solar radiation drives crop photosynthesis, evaporation and solar-energy potential.", up: "raising solar-energy potential and evaporation", down: "showing more cloudy or hazy conditions" },
  et0: { what: "Reference evapotranspiration (ET₀) — an estimate of how much water evaporates from soil and plants.", why: "ET₀ directly sets crop water demand and irrigation scheduling.", up: "raising irrigation demand and water stress", down: "showing reduced water demand" },
  dewpoint: { what: "The temperature at which air becomes saturated and dew or frost begins to form.", why: "A higher dew point means more moisture in the air — a true measure of mugginess and rain potential.", up: "more atmospheric moisture — more mugginess and rain potential", down: "showing drier air" },
  skin_temp: { what: "The ground surface's own temperature (not the air) — the sun-heated soil and vegetation surface.", why: "Surface temperature directly sets how fast soil dries, urban heat and evaporation.", up: "surface heating up — soil drying faster", down: "showing a cooler surface" },
  soil_t1: { what: "The temperature of the topsoil layer (0–7 cm) — the seed-germination zone.", why: "Germination, sprouting and surface biological activity all hinge on this layer.", up: "faster germination but also more surface drying", down: "cooler soil — slower germination" },
  soil_t2: { what: "The temperature of the root zone (7–28 cm) — the main rooting zone of most crops.", why: "Root growth and nutrient uptake depend on this layer's warmth.", up: "a warmer root zone", down: "a cooler root zone" },
  soil_t3: { what: "The temperature of the deeper soil layer (28–100 cm).", why: "Important for deep-rooted perennial crops and trees.", up: "deep soil slowly warming", down: "deep soil cooling" },
  soil_t4: { what: "The temperature of the deepest soil layer (1–2.5 m), with little seasonal swing.", why: "Reflects long-term geothermal storage and groundwater temperature.", up: "long-term ground-heat increase", down: "long-term ground-heat decline" },
  soil_m1: { what: "The volumetric percent of water in the topsoil (0–7 cm).", why: "A direct indicator of germination conditions and surface drought stress.", up: "moister topsoil — germination-friendly", down: "increasing surface drought stress" },
  soil_m2: { what: "Soil moisture in the root zone (7–28 cm).", why: "This is the water crops actually drink — the core basis for irrigation decisions.", up: "a larger plant-available water store", down: "raising irrigation demand and crop stress" },
  soil_m3: { what: "Soil moisture in the deep layer (28–100 cm).", why: "This layer holds the reserve that sustains crops through long dry spells.", up: "a strengthened deep water reserve", down: "a depleting deep water reserve" },
  soil_m4: { what: "Soil moisture in the deepest layer (1–2.5 m).", why: "Reflects groundwater recharge and the long-term water source for perennials.", up: "a stronger groundwater reserve", down: "a declining long-term reserve — a serious signal" },
  snow_depth: { what: "The water-equivalent depth of snow on the ground (how much water it would melt to).", why: "Highland snow melts gradually in spring and summer, sustaining rivers and irrigation.", up: "a growing snow reserve", down: "a shrinking snow reserve — less spring flow" },
  snow_cover: { what: "What percent of the area is covered by snow.", why: "Snow cover sets surface reflectivity, soil warmth and spring water supply.", up: "increasing snow cover", down: "declining snow cover" },
  lai_high: { what: "The leaf-density index of tall vegetation (trees) — square metres of leaf per square metre of ground.", why: "Tree leaf density reflects forest health, shade, carbon uptake and biodiversity.", up: "increasing forest cover and greenery", down: "forest loss or drought stress" },
  lai_low: { what: "The leaf-density index of low vegetation (grass, crops, shrubs).", why: "Reflects grazing, crop growth and ground-cover greenery.", up: "increasing grass and crop greenery", down: "declining greenery" },
  albedo: { what: "Surface reflectivity (albedo) — what percent of sunlight the surface reflects back.", why: "High reflectivity (snow/bare) cools; low (forest/water) absorbs heat — an indicator of land-use change.", up: "the surface getting brighter (snow, bare or exposed)", down: "the surface getting darker (forest or crops)" },
  msl: { what: "Air pressure reduced to sea level — the standard for comparing weather systems across elevations.", why: "Low-pressure systems link to storms and monsoon; high pressure to clear, settled weather.", up: "a tendency toward high-pressure, settled weather", down: "more low-pressure, rainy systems" },
  wind100: { what: "Wind speed 100 m above the ground — wind-turbine height.", why: "This is the decisive height for assessing wind-energy potential.", up: "increasing wind-energy potential", down: "decreasing wind-energy potential" },
  tcwv: { what: "Total column water vapour — all the water in the air column above your head (kg/m²).", why: "The more there is, the more fuel for heavy rain — a direct indicator of monsoon intensity.", up: "more atmospheric moisture fuel — heavy-rain potential", down: "a drying atmosphere" },
  cape: { what: "Convective available potential energy (CAPE) — how 'explosive' the atmosphere is, the fuel for thunderstorms.", why: "High CAPE means a rising chance of violent thunderstorms, hail and lightning.", up: "rising risk of violent storms and lightning", down: "showing a stable atmosphere" },
};

export type StatInput = {
  unit: string; decimals: number;
  baseMean: number | null; perDecade: number; totalChange: number;
  warmIdx: number; warmVal: number; coldIdx: number; coldVal: number;
  y0: number; y1: number; agg: "mean" | "sum";
};

// turn the actual statistics into a plain-language reading (Nepali or English)
export function statInterpretation(id: string, s: StatInput, lang: "ne" | "en" = "ne"): string {
  const en = lang === "en";
  const d = (en ? VAR_DESC_EN : VAR_DESC)[id];
  const num = (v: number, dec = s.decimals) => en ? v.toFixed(dec) : toNe(v.toFixed(dec));
  const yr = (y: number) => en ? String(y) : toNe(y);
  const mon = (i: number) => en ? MONTHS_EN[i] : MONTHS_NE[i];
  const sgn = (v: number) => (v >= 0 ? "+" : "");
  const dir = s.perDecade > 0.005 ? "up" : s.perDecade < -0.005 ? "down" : "flat";
  const cons = dir === "up" ? (d?.up || "") : dir === "down" ? (d?.down || "") : (en ? "no major change" : "ठूलो परिवर्तन देखिँदैन");
  const parts: string[] = [];
  if (en) {
    const word = dir === "up" ? "rising" : dir === "down" ? "falling" : "stable";
    if (s.baseMean != null) parts.push(`<b>Baseline:</b> the 1991–2020 average is <b>${num(s.baseMean)} ${s.unit}</b>.`);
    parts.push(`<b>Seasonal pattern:</b> across the year it peaks in <b>${mon(s.warmIdx)}</b> (${num(s.warmVal)}) and is lowest in <b>${mon(s.coldIdx)}</b> (${num(s.coldVal)}) ${s.unit}.`);
    parts.push(`<b>Long-term trend:</b> from ${yr(s.y0)} to ${yr(s.y1)} it is <b>${word}</b> at ${sgn(s.perDecade)}${num(s.perDecade, 2)} ${s.unit}/decade (total ${sgn(s.totalChange)}${num(s.totalChange)} ${s.unit}) — ${cons}.`);
  } else {
    const word = dir === "up" ? "बढ्दो" : dir === "down" ? "घट्दो" : "स्थिर";
    if (s.baseMean != null) parts.push(`<b>आधाररेखा:</b> सन् १९९१–२०२० मा यसको सरदर मान <b>${num(s.baseMean)} ${s.unit}</b> रहेको छ ।`);
    parts.push(`<b>मौसमी ढाँचा:</b> वर्षभरि <b>${mon(s.warmIdx)}</b> मा सर्वाधिक (${num(s.warmVal)}) र <b>${mon(s.coldIdx)}</b> मा न्यूनतम (${num(s.coldVal)}) ${s.unit} देखिन्छ ।`);
    parts.push(`<b>दीर्घकालीन प्रवृत्ति:</b> सन् ${yr(s.y0)}–${yr(s.y1)} बीच यो प्रति दशक ${sgn(s.perDecade)}${num(s.perDecade, 2)} ${s.unit} का दरले <b>${word}</b> छ (कुल ${sgn(s.totalChange)}${num(s.totalChange)} ${s.unit}) — ${cons} ।`);
  }
  return parts.join(" ");
}
