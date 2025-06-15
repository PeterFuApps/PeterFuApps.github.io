(() => {
  const Util = window.Util;
  const PriorityScheduler = window.PriorityScheduler;
  console.log("observer:start")

  class NavbarDOMObserver {
    // 私有字段，最大化性能
    #navElement = null;
    #navHeight = 0;
    #resizeObserver = null;
    #styleMap = null;
    #updateScheduled = false;
    #eventDetail = { height: 0 }; // 可重用的事件详情对象

    // 静态常量
    static #NAVBAR_SELECTOR = 'nav';
    static #CSS_VAR_NAME = '--navbar-height';
    static #EVENT_NAME = 'dom:navHeightChanged';
    static #SCHEDULE_ID = 'dom:navbarResize';

    // 静态缓存引用
    static #documentElement = document.documentElement;
    static #window = window;

    // 静态实例（单例模式）
    static #instance = null;

    constructor() {
      // 单例模式强制执行
      if (NavbarDOMObserver.#instance) {
        return NavbarDOMObserver.#instance;
      }

      // 立即初始化
      this.#init();

      NavbarDOMObserver.#instance = this;
    }

    // 私有方法使用箭头函数确保 this 绑定
    #getNavElement = () => {
      // 缓存导航栏元素以避免重复的 DOM 查询
      return this.#navElement ??= document.querySelector(NavbarDOMObserver.#NAVBAR_SELECTOR);
    }

    #getStyleMap = () => {
      // 惰性初始化 styleMap
      return this.#styleMap ??= Util.createAttributeStyleMap(NavbarDOMObserver.#documentElement);
    }

    #updateNavHeight = () => {
      const nav = this.#navElement;
      if (!nav) return 0;

      // 使用 offsetHeight 获得更好的性能（避免重排）
      // 返回包含 padding + border 的整数值
      const newHeight = nav.offsetHeight;

      // 快速相等性检查
      if (newHeight === this.#navHeight) {
        return newHeight;
      }

      // 更新内部状态
      this.#navHeight = newHeight;

      // 使用缓存的 styleMap 更新 CSS 变量
      this.#getStyleMap().setProperty(
        NavbarDOMObserver.#CSS_VAR_NAME,
        `${newHeight}px`
      );

      // 重用事件详情对象以避免分配
      this.#eventDetail.height = newHeight;

      // 派发自定义事件
      NavbarDOMObserver.#window.dispatchEvent(
        new CustomEvent(NavbarDOMObserver.#EVENT_NAME, {
          detail: this.#eventDetail,
          bubbles: false, // 显式设置以提高性能
          cancelable: false
        })
      );

      return newHeight;
    }

    #scheduledUpdate = () => {
      // 防止重复调度
      if (this.#updateScheduled) return;

      this.#updateScheduled = true;

      // 使用缓存的 PriorityScheduler 引用
      PriorityScheduler.schedule(
        NavbarDOMObserver.#SCHEDULE_ID,
        () => {
          this.#updateScheduled = false;
          this.#updateNavHeight();
        },
        {
          priority: PriorityScheduler.Priority.LOW,
        }
      );
    }

    #init = () => {
      const nav = this.#getNavElement();
      if (!nav) return false;

      // 初始高度更新
      this.#updateNavHeight();

      // 设置 ResizeObserver，使用优化的回调
      if (window.ResizeObserver) {
        this.#resizeObserver = new ResizeObserver(() => this.#scheduledUpdate());
        this.#resizeObserver.observe(nav);
      }

      return true;
    }

    // 公共方法使用箭头函数
    destroy = () => {
      // 清理 ResizeObserver
      this.#resizeObserver?.disconnect();

      // 使用缓存引用取消任何计划中的更新
      if (this.#updateScheduled) {
        PriorityScheduler.cancel(NavbarDOMObserver.#SCHEDULE_ID);
      }

      // 重置所有引用
      this.#resizeObserver = null;
      this.#navElement = null;
      this.#navHeight = 0;
      this.#styleMap = null;
      this.#updateScheduled = false;

      // 如果销毁的是单例实例，清除单例引用
      if (NavbarDOMObserver.#instance === this) {
        NavbarDOMObserver.#instance = null;
      }
    }

    getHeight = () => {
      // 如果已经初始化，返回缓存的高度值
      if (this.#navElement !== null) {
        return this.#navHeight;
      }

      // 如果未初始化，尝试初始化并返回高度
      if (this.#init()) {
        return this.#navHeight;
      }

      // 初始化失败，返回 0
      return 0;
    }

    forceUpdate = () => {
      // 使用缓存引用取消计划中的更新（如果有）
      if (this.#updateScheduled) {
        PriorityScheduler.cancel(NavbarDOMObserver.#SCHEDULE_ID);
        this.#updateScheduled = false;
      }

      // 如果尚未初始化，先尝试初始化
      if (!this.#navElement && !this.#init()) {
        return 0;
      }

      return this.#updateNavHeight();
    }

    // 使用 ES6 语法的 getter 属性
    get isInitialized() {
      return this.#navElement !== null;
    }

    get height() {
      return this.#navHeight;
    }

    get element() {
      return this.#navElement;
    }

    // 静态工厂方法用于获取/创建实例
    static getInstance = () => {
      return NavbarDOMObserver.#instance ??= new NavbarDOMObserver();
    }
  }

  // 创建并导出全局实例
  window.NavbarDOMObserver = NavbarDOMObserver.getInstance();
})();

(async () => {
  const PriorityScheduler = window.PriorityScheduler;
  const CONSTANT = window.CONSTANT;

  /**
   * CSS 变量主题监听器
   * 监听主题变化并提供获取CSS变量的方法
   */
  class CSSVariableListener {
    #root;
    #observer;
    #dataThemeEventName = CONSTANT.CUSTOM_EVENT.DATA_THEME_UPDATE;
    #colorThemeEventName = CONSTANT.CUSTOM_EVENT.COLOR_THEME_UPDATE;

    constructor() {
      this.#root = document.documentElement;
      this.#init();
    }

    /**
     * 获取CSS变量的值
     * @param {string} varName - CSS变量名（需要包含 -- 前缀）
     * @returns {string} CSS变量的值
     */
    get = (varName, target) => {
      if (!target) target = this.#root;
      return getComputedStyle(target).getPropertyValue(varName).trim();
    }

    /**
    * 获取当前主题
    * @returns {'dark' | 'light'} 当前主题名称
    */
    getDataTheme = () => {
      const dataTheme = this.#root.getAttribute('data-theme');
      return dataTheme || 'light';
    }

    /**
     * 获取当前颜色主题
     * @returns {string} 当前颜色主题名称，默认为 'default'
     */
    getColorTheme = () => {
      const colorTheme = this.#root.getAttribute('color-theme');
      return colorTheme || 'default';
    }

    /**
     * 初始化监听器
     */
    #init = () => {
      // 创建 MutationObserver 监听属性变化
      this.#observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'data-theme') {
              this.#emitDataThemeUpdate();
            } else if (mutation.attributeName === 'color-theme') {
              this.#emitColorThemeUpdate();
            }
          }
        });
      });

      // 开始监听 root 元素的属性变化
      this.#observer.observe(this.#root, {
        attributes: true,
        attributeFilter: ['data-theme', 'color-theme']
      });

      // 发布初始事件
      this.#emitDataThemeUpdate();
      this.#emitColorThemeUpdate();

      const LifeCycleManager = window.LifeCycleManager;
      LifeCycleManager.register(this.#destroy);
    }

    /**
     * 发布主题更新事件
     */
    #emitDataThemeUpdate = () => {
      const event = new CustomEvent(this.#dataThemeEventName, {
        detail:{
          dataTheme: this.getDataTheme()
        },
        bubbles: true,
        cancelable: false
      });

      this.#root.dispatchEvent(event);
    }

    /**
     * 发布颜色主题更新事件
     */
    #emitColorThemeUpdate = () => {
      const event = new CustomEvent(this.#colorThemeEventName, {
        detail: {
          colorTheme: this.getColorTheme()
        },
        bubbles: true,
        cancelable: false
      });

      this.#root.dispatchEvent(event);
    }

    /**
     * 销毁监听器
     */
    #destroy = () => {
      if (this.#observer) {
        this.#observer.disconnect();
        this.#observer = null;
      }
    }
  }
  console.log("observer:wait")
  console.log("observer:end")
  window.CSSVariableListener = new CSSVariableListener();
})();