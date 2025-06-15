(async () => {
  'use strict';
  console.log("shine:start")

  const CONSTANT = window.CONSTANT;
  const Util = window.Util;
  const CSSVariableListener = window.CSSVariableListener;
  const PriorityScheduler = window.PriorityScheduler;

  let currentTheme = null;
  const updateCurrentTheme = () => {
    currentTheme = CSSVariableListener.getDataTheme()
  }
  updateCurrentTheme();
  window.addEventListener(CONSTANT.CUSTOM_EVENT.DATA_THEME_UPDATE, updateCurrentTheme);

  // 配置常量
  const CONFIG = {
    GLOW_INTENSITY: 0.08,
    TILT_INTENSITY: 1,
    TRANSLATE_Z: 20,
    UPDATE_THRESHOLD: 100,
    MOUSE_IDLE_THRESHOLD: 16,
    POOL_SIZE: 20,
    TRANSFORM_THRESHOLD: 0.2,
    TRANSFORM_UPDATE_INTERVAL: 50, // 形变更新间隔（毫秒）
    OBSERVER_MARGIN: '50px',
    get SHADOW_MIN_OPACITY() { // 最小阴影强度
      console.log(currentTheme)
      return {
        light: 0.3,
        dark: 0.5
      }[currentTheme]
    },
    get SHADOW_MAX_OPACITY() { // 最大阴影强度
      return {
        light: 0.5,
        dark: 0.8
      }[currentTheme]
    },
    SHADOW_MAX_DISTANCE: 4,  // 阴影最大偏移距离
    SHADOW_BLUR: 7,          // 阴影模糊半径
    SHADOW_SPREAD: -0.5         // 阴影扩散
  };

  const SELECTOR = '.ui-card.ui-hoverable, .ui-card.ui-interactive';
  const selectorParts = SELECTOR.split(',').map(s => s.trim());

  // CSS 变量名称
  const CSS_VARS = Object.freeze({
    GLOW_OPACITY: '--glow-opacity',
    ROTATE_X: '--rotate-x',
    ROTATE_Y: '--rotate-y',
    TRANSLATE_Z: '--translate-z',
    MOUSE_X: '--mouse-x',
    MOUSE_Y: '--mouse-y',
    GLOW_INTENSITY: '--glow-intensity',
    SHADOW_OPACITY: '--ui-shadow-opacity',
    SHADOW_HOVER_OPACITY: '--ui-shadow-hover-opacity',
    SHADOW_X: '--shadow-x',
    SHADOW_Y: '--shadow-y',
    SHADOW_BLUR: '--shadow-blur',
    SHADOW_SPREAD: '--shadow-spread'
  });

  // 格式化数值方法
  // 确保所有数值样式值最多保留3位小数，避免精度问题
  const formatValue = (value, unit = '') => {
    if (typeof value !== 'number') return value;

    // 整数直接返回，无需格式化
    if (Number.isInteger(value)) {
      return value + unit;
    }

    // 小数保留最多3位，并移除末尾无意义的0
    const formatted = parseFloat(value.toFixed(3));
    return formatted + unit;
  };

  // 预创建样式值
  const STYLE_VALUES = Object.freeze({
    ZERO: '0',
    ZERO_DEG: '0deg',
    ZERO_PX: '0px',
    ONE: '1',
    TRANSLATE_Z: formatValue(CONFIG.TRANSLATE_Z, 'px'),
    GLOW_INTENSITY: formatValue(CONFIG.GLOW_INTENSITY),
    MIN_SHADOW_OPACITY: formatValue(CONFIG.SHADOW_MIN_OPACITY),
    DEFAULT_SHADOW_BLUR: formatValue(CONFIG.SHADOW_BLUR, 'px'),
    DEFAULT_SHADOW_SPREAD: formatValue(CONFIG.SHADOW_SPREAD, 'px')
  });

  // 对象池类
  class ObjectPool {
    constructor(factory, reset, maxSize = CONFIG.POOL_SIZE) {
      this.factory = factory;
      this.reset = reset;
      this.maxSize = maxSize;
      this.pool = [];
    }

    acquire = () => {
      const { pool, factory } = this;
      return pool.pop() || factory();
    }

    release = (obj) => {
      const { pool, maxSize, reset } = this;
      if (pool.length < maxSize) {
        reset(obj);
        pool.push(obj);
      }
    }
  }

  // 矩形对象池
  const rectPool = new ObjectPool(
    () => ({ left: 0, top: 0, width: 0, height: 0 }),
    rect => Object.assign(rect, { left: 0, top: 0, width: 0, height: 0 })
  );

  // 样式更新器类
  class StyleUpdater {
    updates = new Map();
    styleMaps = new WeakMap(); // 缓存 styleMap 对象

    set = (element, props) => {
      const { updates } = this;
      const existing = updates.get(element) || {};
      updates.set(element, { ...existing, ...props });
    }

    flush = () => {
      const { updates, applyStyles } = this;
      updates.forEach((props, element) => applyStyles(element, props));
      updates.clear();
    }

    // 获取或创建 styleMap
    getStyleMap = (element) => {
      const { styleMaps } = this;
      if (!styleMaps.has(element)) {
        styleMaps.set(element, Util.createAttributeStyleMap(element));
      }
      return styleMaps.get(element);
    }

    applyStyles = (element, props) => {
      const styleMap = this.getStyleMap(element);

      Object.entries(props).forEach(([prop, value]) => {
        if (value === null) {
          styleMap.removeProperty(prop);
        } else {
          styleMap.setProperty(prop, value);
        }
      });
    }
  }

  // 卡片管理器类
  class CardManager {
    cache = new WeakMap();
    transformCache = new WeakMap();
    visibleCards = new Set();
    styleUpdater = new StyleUpdater();
    lastTransformUpdate = new WeakMap(); // 记录上次形变更新时间

    getData = (card) => {
      const { cache } = this;
      if (!cache.has(card)) {
        cache.set(card, {
          rect: rectPool.acquire(),
          lastUpdate: 0,
          initialized: false,
          halfWidth: 0,
          halfHeight: 0,
          centerX: 0,
          centerY: 0
        });
      }
      return cache.get(card);
    }

    initCard = (card) => {
      const data = this.getData(card);
      if (data.initialized) return;

      const { styleUpdater } = this;
      styleUpdater.set(card, {
        [CSS_VARS.GLOW_OPACITY]: STYLE_VALUES.ZERO,
        [CSS_VARS.ROTATE_X]: STYLE_VALUES.ZERO_DEG,
        [CSS_VARS.ROTATE_Y]: STYLE_VALUES.ZERO_DEG,
        [CSS_VARS.TRANSLATE_Z]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_OPACITY]: STYLE_VALUES.MIN_SHADOW_OPACITY,
        [CSS_VARS.SHADOW_HOVER_OPACITY]: STYLE_VALUES.MIN_SHADOW_OPACITY,
        [CSS_VARS.SHADOW_X]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_Y]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_BLUR]: STYLE_VALUES.DEFAULT_SHADOW_BLUR,
        [CSS_VARS.SHADOW_SPREAD]: STYLE_VALUES.DEFAULT_SHADOW_SPREAD
      });
      styleUpdater.flush();

      data.initialized = true;
    }

    updateRect = (card, force = false) => {
      const data = this.getData(card);
      const now = performance.now();

      if (!force && now - data.lastUpdate < CONFIG.UPDATE_THRESHOLD) {
        return data.rect;
      }

      const { left, top, width, height } = card.getBoundingClientRect();
      const { rect } = data;

      Object.assign(rect, { left, top, width, height });

      data.halfWidth = width * 0.5;
      data.halfHeight = height * 0.5;
      data.centerX = left + data.halfWidth;
      data.centerY = top + data.halfHeight;
      data.lastUpdate = now;

      return rect;
    }

    resetCard = (card) => {
      const { transformCache, styleUpdater } = this;
      const transform = transformCache.get(card);
      if (!transform?.active) return;

      styleUpdater.set(card, {
        [CSS_VARS.GLOW_OPACITY]: STYLE_VALUES.ZERO,
        [CSS_VARS.ROTATE_X]: STYLE_VALUES.ZERO_DEG,
        [CSS_VARS.ROTATE_Y]: STYLE_VALUES.ZERO_DEG,
        [CSS_VARS.TRANSLATE_Z]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_OPACITY]: null,
        [CSS_VARS.SHADOW_HOVER_OPACITY]: null,
        [CSS_VARS.SHADOW_X]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_Y]: STYLE_VALUES.ZERO_PX,
        [CSS_VARS.SHADOW_BLUR]: STYLE_VALUES.DEFAULT_SHADOW_BLUR,
        [CSS_VARS.SHADOW_SPREAD]: STYLE_VALUES.DEFAULT_SHADOW_SPREAD
      });

      if (transform) transform.active = false;
    }

    // 仅更新光泽效果（实时响应）
    updateGlow = (card, mouseX, mouseY) => {
      const data = this.getData(card);
      const { rect } = data;
      const { styleUpdater } = this;

      // 立即更新鼠标位置和光泽
      styleUpdater.set(card, {
        [CSS_VARS.MOUSE_X]: Util.formatValue(mouseX - rect.left, 'px'),
        [CSS_VARS.MOUSE_Y]: Util.formatValue(mouseY - rect.top, 'px'),
        [CSS_VARS.GLOW_OPACITY]: STYLE_VALUES.ONE,
        [CSS_VARS.GLOW_INTENSITY]: STYLE_VALUES.GLOW_INTENSITY
      });
    }

    // 更新形变效果（节流）
    updateTransform = (card, mouseX, mouseY) => {
      const now = performance.now();
      const lastUpdate = this.lastTransformUpdate.get(card) || 0;

      // 检查是否需要更新形变
      if (now - lastUpdate < CONFIG.TRANSFORM_UPDATE_INTERVAL) {
        return false; // 不需要更新
      }

      this.lastTransformUpdate.set(card, now);

      const data = this.getData(card);
      const { centerX, centerY, halfWidth, halfHeight } = data;

      // 计算鼠标相对于卡片中心的百分比位置
      const percentX = (mouseX - centerX) / halfWidth;
      const percentY = (mouseY - centerY) / halfHeight;

      // 计算距离中心点的距离（标准化到0-1范围）
      const distance = Math.sqrt(percentX * percentX + percentY * percentY);
      // 限制最大距离为1
      const clampedDistance = Math.min(distance, 1);

      // 基于距离计算效果强度
      // 旋转效果：直接使用百分比位置
      const rotateX = -percentY * CONFIG.TILT_INTENSITY;
      const rotateY = percentX * CONFIG.TILT_INTENSITY;

      // 阴影透明度：距离越近，阴影越强
      const shadowOpacity = CONFIG.SHADOW_MIN_OPACITY +
        (CONFIG.SHADOW_MAX_OPACITY - CONFIG.SHADOW_MIN_OPACITY) * (1 - clampedDistance);

      // 阴影偏移：在中心时偏移为0，距离越远偏移越大
      // 阴影方向与鼠标方向相反
      const shadowX = -percentX * CONFIG.SHADOW_MAX_DISTANCE * clampedDistance;
      const shadowY = -percentY * CONFIG.SHADOW_MAX_DISTANCE * clampedDistance;

      // 获取或创建变换缓存
      const { transformCache, styleUpdater } = this;
      let transform = transformCache.get(card);
      if (!transform) {
        transform = {
          active: false,
          rotateX: 0,
          rotateY: 0,
          shadowOpacity: CONFIG.SHADOW_MIN_OPACITY,
          shadowX: 0,
          shadowY: 0
        };
        transformCache.set(card, transform);
      }

      // 检查是否需要更新
      const { TRANSFORM_THRESHOLD } = CONFIG;
      const needsUpdate =
        Math.abs(transform.rotateX - rotateX) >= TRANSFORM_THRESHOLD ||
        Math.abs(transform.rotateY - rotateY) >= TRANSFORM_THRESHOLD ||
        Math.abs(transform.shadowOpacity - shadowOpacity) >= 0.01 ||
        Math.abs(transform.shadowX - shadowX) >= TRANSFORM_THRESHOLD ||
        Math.abs(transform.shadowY - shadowY) >= TRANSFORM_THRESHOLD ||
        !transform.active;

      if (!needsUpdate) return false;

      Object.assign(transform, {
        rotateX,
        rotateY,
        shadowOpacity,
        shadowX,
        shadowY,
        active: true
      });

      styleUpdater.set(card, {
        [CSS_VARS.ROTATE_X]: Util.formatValue(rotateX, 'deg'),
        [CSS_VARS.ROTATE_Y]: Util.formatValue(rotateY, 'deg'),
        [CSS_VARS.TRANSLATE_Z]: STYLE_VALUES.TRANSLATE_Z,
        [CSS_VARS.SHADOW_OPACITY]: Util.formatValue(shadowOpacity),
        [CSS_VARS.SHADOW_HOVER_OPACITY]: Util.formatValue(shadowOpacity),
        [CSS_VARS.SHADOW_X]: Util.formatValue(shadowX, 'px'),
        [CSS_VARS.SHADOW_Y]: Util.formatValue(shadowY, 'px')
      });

      return true;
    }

    // 完整更新（包括光泽和形变）
    updateCard = (card, mouseX, mouseY) => {
      // 光泽总是更新
      this.updateGlow(card, mouseX, mouseY);

      // 形变根据时间间隔更新
      this.updateTransform(card, mouseX, mouseY);
    }

    cleanup = (card, currentCard) => {
      if (card === currentCard) return;

      const { cache, transformCache, lastTransformUpdate, styleUpdater } = this;
      const data = cache.get(card);
      if (data) {
        rectPool.release(data.rect);
        cache.delete(card);
        transformCache.delete(card);
        lastTransformUpdate.delete(card);
        styleUpdater.styleMaps.delete(card);
      }
    }
  }

  // 主应用类
  class ShineEffect {
    mouseX = 0;
    mouseY = 0;
    prevMouseX = 0;
    prevMouseY = 0;
    rafId = null;
    currentCard = null;
    isMouseInViewport = true;
    isMouseMoving = false;
    mouseIdleTimer = null;
    updateTimer = null;
    cardManager = new CardManager();

    constructor() {
      this.initObservers();
      this.initEventListeners();
      this.updateCardsList();
    }

    matchesSelector = (element) => {
      if (!element?.matches) return false;
      return selectorParts.some(selector => element.matches(selector));
    }

    handleMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.isMouseMoving = true;

      clearTimeout(this.mouseIdleTimer);
      this.mouseIdleTimer = setTimeout(() => {
        this.isMouseMoving = false;
      }, CONFIG.MOUSE_IDLE_THRESHOLD);

      const { rafId } = this;
      if (!rafId) {
        this.rafId = requestAnimationFrame(this.update);
      }
    }

    handleMouseEnter = () => {
      this.isMouseInViewport = true;
    }

    handleMouseLeave = () => {
      this.isMouseInViewport = false;
      const { rafId } = this;
      if (!rafId) {
        this.rafId = requestAnimationFrame(this.update);
      }
    }

    update = () => {
      this.rafId = null;

      const {
        mouseX, mouseY, prevMouseX, prevMouseY,
        currentCard, isMouseMoving, isMouseInViewport,
        cardManager
      } = this;

      // 检查鼠标是否移动
      const mouseMoved =
        Math.abs(mouseX - prevMouseX) > 1 ||
        Math.abs(mouseY - prevMouseY) > 1;

      if (!mouseMoved && currentCard && !isMouseMoving) {
        return;
      }

      this.prevMouseX = mouseX;
      this.prevMouseY = mouseY;

      // 鼠标不在视口内
      if (!isMouseInViewport) {
        if (currentCard) {
          cardManager.resetCard(currentCard);
          cardManager.styleUpdater.flush();
          this.currentCard = null;
        }
        return;
      }

      // 查找悬停的卡片
      const hoveredCard = this.findHoveredCard();

      // 状态未改变，只更新当前卡片
      if (hoveredCard === currentCard && hoveredCard) {
        cardManager.updateCard(hoveredCard, mouseX, mouseY);
        cardManager.styleUpdater.flush();
        return;
      }

      // 状态改变
      if (currentCard && currentCard !== hoveredCard) {
        cardManager.resetCard(currentCard);
      }

      this.currentCard = hoveredCard;

      if (hoveredCard) {
        cardManager.updateRect(hoveredCard, true);
        cardManager.updateCard(hoveredCard, mouseX, mouseY);
      }

      cardManager.styleUpdater.flush();
    }

    findHoveredCard = () => {
      const { mouseX, mouseY, cardManager, matchesSelector } = this;
      const element = document.elementFromPoint(mouseX, mouseY);
      if (!element) return null;

      let current = element;
      while (current && current !== document.body) {
        if (matchesSelector(current) &&
          cardManager.visibleCards.has(current)) {
          cardManager.initCard(current);
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    initObservers = () => {
      const { cardManager } = this;

      // Intersection Observer
      this.visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting) {
            cardManager.visibleCards.add(target);
          } else {
            cardManager.visibleCards.delete(target);
            cardManager.cleanup(target, this.currentCard);
          }
        });
      }, {
        rootMargin: CONFIG.OBSERVER_MARGIN,
        threshold: 0
      });

      // Mutation Observer
      this.mutationObserver = new MutationObserver((mutations) => {
        const needsUpdate = mutations.some(({ type, addedNodes }) => {
          if (type !== 'childList' || !addedNodes.length) return false;

          return Array.from(addedNodes).some(node =>
            node.nodeType === 1 &&
            (this.matchesSelector(node) || node.querySelector?.(SELECTOR))
          );
        });

        if (needsUpdate) this.scheduleCardsUpdate();
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    initEventListeners = () => {
      const options = { passive: true };
      const { handleMouseMove, handleMouseEnter, handleMouseLeave } = this;

      window.addEventListener('mousemove', handleMouseMove, options);
      window.addEventListener('mouseenter', handleMouseEnter, options);
      window.addEventListener('mouseleave', handleMouseLeave, options);
    }

    scheduleCardsUpdate = () => {
      const { updateTimer } = this;
      if (updateTimer) return;

      this.updateTimer = setTimeout(() => {
        this.updateTimer = null;
        this.updateCardsList();
      }, 16);
    }

    updateCardsList = () => {
      const { visibilityObserver, cardManager } = this;

      visibilityObserver.disconnect();
      cardManager.visibleCards.clear();

      document.querySelectorAll(SELECTOR).forEach(card => {
        visibilityObserver.observe(card);
      });
    }

    destroy = () => {
      const {
        visibilityObserver, mutationObserver,
        rafId, mouseIdleTimer, updateTimer,
        cardManager
      } = this;

      // 清理所有卡片
      cardManager.visibleCards.forEach(card => {
        cardManager.resetCard(card);
      });
      cardManager.styleUpdater.flush();

      // 清理缓存
      cardManager.cache = new WeakMap();
      cardManager.transformCache = new WeakMap();
      cardManager.lastTransformUpdate = new WeakMap();
      cardManager.styleUpdater.styleMaps = new WeakMap();
      cardManager.visibleCards.clear();

      visibilityObserver?.disconnect();
      mutationObserver?.disconnect();
      cancelAnimationFrame(rafId);
      clearTimeout(mouseIdleTimer);
      clearTimeout(updateTimer);
    }
  }

  console.log("shine:wait")
  await PriorityScheduler.ensureDocumentReady()
  console.log("shine:end")
  new ShineEffect();

})();