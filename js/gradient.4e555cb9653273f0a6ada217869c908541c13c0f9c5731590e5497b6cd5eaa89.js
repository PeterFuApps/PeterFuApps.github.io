const gradients = [
  "mint_splash",
  "violet_dream",
  "golden_rays",
  "juicy_peach",
  "sunny_morning",
  "dusty_grass",
  "tempting_azure",
  "ripe_malinka",
  "malibu_beach",
  "new_life",
  "true_sunset",
  "morpheus_den",
  "near_moon",
  "arielles_smile",
  "plum_plate",
  "happy_fisher",
  "lemon_gate",
  "itmeo_branding",
  "deep_blue",
  "happy_acid",
  "mixed_hopes",
  "fly_high",
  "grown_early",
  "sharp_blues",
  "shady_water",
  "night_party",
  "sky_glider",
  "purple_division",
  "aqua_splash",
  "love_kiss",
  "summer_games",
  "passionate_bed",
  "phoenix_start",
  "october_silence",
  "faraway_river",
  "alchemist_lab",
  "over_sun",
  "mars_party",
  "healthy_water",
  "amour_amour",
  "palo_alto",
  "happy_memories",
  "crystalline",
  "party_bliss",
  "frozen_berry",
  "flying_lemon",
  "hidden_jaguar",
  "seashore",
  "young_grass",
  "plum_bath",
  "happy_unicorn",
  "orange_juice",
  "north_miracle",
  "fruit_blend",
  "millennium_pine",
  "high_flight",
  "juicy_cake",
  "smart_indigo",
  "norse_beauty",
  "aqua_guidance",
  "sun_veggie",
  "grass_shampoo",
  "landing_aircraft",
  "crystal_river",
  "sea_strike",
  "night_call",
  "supreme_sky",
  "light_blue",
  "sugar_lollipop",
  "magic_ray",
  "teen_party",
  "frozen_heat",
  "fabled_sunset"
];

(async function injectBackground() {
  const PriorityScheduler = window.PriorityScheduler;
  const Util = window.Util;

  const elementList = document.querySelectorAll(".ui-no-image");
  if (elementList.length === 0) return;

  const processElementBatch = () => {
    // 创建重复序列并打乱
    const sequence = Array.from({ length: elementList.length }, (_, i) =>
      gradients[i % gradients.length]
    );

    // 洗牌算法
    for (let i = sequence.length - 1; i > 0; i--) {
      const j = Util.trueRandom(i + 1);
      [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
    }

    // 应用渐变类到元素
    elementList.forEach((element, index) => {
      element.classList.add(sequence[index]);
    });
  };

  // 开始处理，使用异步调度器
  await PriorityScheduler.wait('gradient_batch', {
    priority: PriorityScheduler.Priority.HIGH
  });

  processElementBatch();
})();