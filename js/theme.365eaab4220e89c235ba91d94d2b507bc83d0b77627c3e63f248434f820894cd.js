// 主题处理
(function setupTheme() {
  const PriorityScheduler = window.PriorityScheduler;
  const Util = window.Util;

  // 方案1：经典色彩分类（推荐）
  const colorThemes = [
    // 中性色组 - 基础色彩
    { value: "default", title: "默认 Default", category: "neutral" },

    // 红色系组 - 包含红色调的所有颜色
    { value: "red", title: "红色 Red", category: "red" },
    { value: "pink", title: "粉色 Pink", category: "red" },
    { value: "wine", title: "酒红色 Wine", category: "red" },

    // 黄橙色系组 - 暖色调
    { value: "yellow", title: "黄色 Yellow", category: "yellow" },
    { value: "orange", title: "橙色 Orange", category: "yellow" },
    { value: "brown", title: "棕色 Brown", category: "yellow" },

    // 绿色系组 - 自然色调
    { value: "green", title: "绿色 Green", category: "green" },
    { value: "yellowgreen", title: "草绿 Lawn", category: "green" },

    // 蓝色系组 - 冷色调
    { value: "teal", title: "青色 Teal", category: "blue" },
    { value: "cyan", title: "青绿色 Cyan", category: "blue" },
    { value: "blue", title: "蓝色 Blue", category: "blue" },
    // { value: "navy", title: "深蓝色 Navy", category: "blue" },
    { value: "indigo", title: "靛蓝色 Indigo", category: "blue" },

    // 紫色系组
    { value: "purple", title: "紫色 Purple", category: "purple" },
    { value: "slate", title: "石板色 Slate", category: "neutral" },
  ];

  // 状态变量
  let isAutoThemeEnabled = true; // 默认启用 auto 主题
  let mediaQueryListener = null;

  // 设置主题模式并保存偏好到本地存储的函数
  const setThemeMode = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    if (!isAutoThemeEnabled) {
      localStorage.setItem("preferred-theme", theme);
    } else {
      localStorage.removeItem("preferred-theme");
    }
    updateActiveStates();
  };

  // 设置颜色主题并保存偏好到本地存储的函数
  const setColorTheme = (colorTheme) => {
    if (colorTheme === "default") {
      document.documentElement.removeAttribute("color-theme");
    } else {
      document.documentElement.setAttribute("color-theme", colorTheme);
    }
    localStorage.setItem("preferred-color-theme", colorTheme);
    updateActiveStates();
  };

  // 获取系统主题偏好
  const getSystemTheme = () => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  // 基于保存的偏好或系统设置获取初始主题的函数
  const getInitialTheme = () => {
    const savedAutoTheme = localStorage.getItem("auto-theme-enabled");
    isAutoThemeEnabled = savedAutoTheme !== "false"; // 默认为 true

    if (isAutoThemeEnabled) {
      return getSystemTheme();
    }

    const savedTheme = localStorage.getItem("preferred-theme");
    return savedTheme || getSystemTheme();
  };

  // 获取初始颜色主题
  const getInitialColorTheme = () => {
    const savedColorTheme = localStorage.getItem("preferred-color-theme");
    if (savedColorTheme) {
      return savedColorTheme;
    }
    return "default";

    // 第一次访问时随机选择一个颜色主题
    /* const randomIndex = Math.floor(Math.random() * colorThemes.length);
    const randomTheme = colorThemes[randomIndex].value;
    localStorage.setItem("preferred-color-theme", randomTheme);
    return randomTheme; */
  };

  // 更新按钮的活动状态
  const updateActiveStates = () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const currentColorTheme =
      document.documentElement.getAttribute("color-theme") || "default";

    // 更新主题模式按钮
    document.querySelectorAll(".data-theme-btn").forEach((btn) => {
      if (btn.getAttribute("data-theme-mode") === currentTheme) {
        btn.classList.add("selected");
      } else {
        btn.classList.remove("selected");
      }
    });

    // 更新颜色主题按钮
    document.querySelectorAll(".color-theme-btn").forEach((btn) => {
      if (btn.getAttribute("data-color-theme") === currentColorTheme) {
        btn.classList.add("selected");
      } else {
        btn.classList.remove("selected");
      }
    });

    // 更新 auto theme toggle 按钮
    const autoThemeToggle = document.getElementById("auto-theme-toggle");
    if (autoThemeToggle) {
      if (isAutoThemeEnabled) {
        autoThemeToggle.classList.add("selected");
      } else {
        autoThemeToggle.classList.remove("selected");
      }
    }
  };

  const generateColorThemeButtons = () => {
    const container = document.getElementById("color-theme-grid");
    if (!container) return;

    const createButtons = () => {
      // 清空容器
      container.innerHTML = "";

      // 生成按钮
      const fragment = document.createDocumentFragment();

      colorThemes.forEach((theme) => {
        const button = document.createElement("button");
        button.classList.add("color-theme-btn", "ui-tooltip");
        button.setAttribute("data-color-theme", theme.value);
        button.setAttribute("data-tooltip", theme.title);
        const shine = document.createElement("div");
        shine.classList.add("ui-shine", "h-full", "w-full");
        button.appendChild(shine);
        fragment.appendChild(button);
      });

      container.appendChild(fragment);

      // 更新激活状态
      updateActiveStates();
    };

    // 使用优先级调度器延迟创建按钮
    PriorityScheduler.schedule("generate-color-buttons", createButtons, {
      priority: PriorityScheduler.Priority.LOW,
    });
  };

  // 启用/禁用 auto theme
  const toggleAutoTheme = () => {
    isAutoThemeEnabled = !isAutoThemeEnabled;
    localStorage.setItem("auto-theme-enabled", isAutoThemeEnabled.toString());

    if (isAutoThemeEnabled) {
      // 启用 auto theme，切换到系统主题
      localStorage.removeItem("preferred-theme");
      setThemeMode(getSystemTheme());
      // 开始监听系统主题变化
      startSystemThemeListener();
    } else {
      // 禁用 auto theme，保存当前主题
      const currentTheme = document.documentElement.getAttribute("data-theme");
      localStorage.setItem("preferred-theme", currentTheme);
      // 停止监听系统主题变化
      stopSystemThemeListener();
    }

    updateActiveStates();
  };

  // 随机选择颜色主题
  const randomColorTheme = () => {
    const currentColorTheme =
      document.documentElement.getAttribute("color-theme") || "default";
    let availableThemes = colorThemes.filter(
      (theme) => theme.value !== currentColorTheme
    );

    const availableThemesByCategory = Object.values(availableThemes.reduce((acc, item) => {
      const key = item.category;
      if (!acc[key]) acc[key] = []
      acc[key].push(item);
      return acc;
    }, {}));

    const selectedThemeCategory = availableThemesByCategory[Util.trueRandom(availableThemesByCategory.length)];
    const selectedTheme = selectedThemeCategory[Util.trueRandom(selectedThemeCategory.length)];

    console.log(selectedThemeCategory[0].category);

    setColorTheme(selectedTheme.value);

    // 使用优先级调度器添加视觉反馈
    const randomBtn = document.getElementById("random-color-theme");
    if (randomBtn) {
      randomBtn.classList.add("animate-spin");

      // 使用优先级调度器确保动画流畅
      PriorityScheduler.schedule(
        "random-color-animation",
        () => {
          // 延迟移除动画类
          PriorityScheduler.schedule(
            "remove-spin-animation",
            () => {
              randomBtn.classList.remove("animate-spin");
            },
            {
              priority: PriorityScheduler.Priority.NORMAL,
              delay: 300,
            }
          );
        },
        {
          priority: PriorityScheduler.Priority.HIGH,
        }
      );
    }
  };

  // 系统主题变化监听器
  const systemThemeChangeHandler = (e) => {
    if (isAutoThemeEnabled) {
      setThemeMode(e.matches ? "dark" : "light");
    }
  };

  // 开始监听系统主题变化
  const startSystemThemeListener = () => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", systemThemeChangeHandler);
      mediaQueryListener = {
        query: mediaQuery,
        handler: systemThemeChangeHandler,
      };
    }
  };

  // 停止监听系统主题变化
  const stopSystemThemeListener = () => {
    if (mediaQueryListener) {
      mediaQueryListener.query.removeEventListener(
        "change",
        mediaQueryListener.handler
      );
      mediaQueryListener = null;
    }
  };

  // 关闭主题菜单
  const closeThemeMenu = () => {
    document.getElementById("theme-menu-toggle").checked = false;
  };

  // 页面加载时应用初始主题
  setThemeMode(getInitialTheme());
  const initialColorTheme = getInitialColorTheme();
  if (initialColorTheme !== "default") {
    setColorTheme(initialColorTheme);
  }

  // 如果启用了 auto theme，开始监听系统主题变化
  if (isAutoThemeEnabled) {
    startSystemThemeListener();
  }

  // 处理主题菜单点击事件
  const handleThemeMenuClick = (event) => {
    // 忽略checkbox自身的点击事件
    if (event.target.type === "checkbox") {
      return;
    }

    // Auto theme toggle
    const autoThemeToggle = event.target.closest("#auto-theme-toggle");
    if (autoThemeToggle) {
      toggleAutoTheme();
      event.preventDefault();
      return;
    }

    // Random color theme
    const randomColorBtn = event.target.closest("#random-color-theme");
    if (randomColorBtn) {
      randomColorTheme();
      event.preventDefault();
      return;
    }

    // 主题模式按钮
    const themeModeBtn = event.target.closest(".data-theme-btn");
    if (themeModeBtn) {
      const themeMode = themeModeBtn.getAttribute("data-theme-mode");

      // 如果当前是自动主题模式，先关闭它
      if (isAutoThemeEnabled) {
        isAutoThemeEnabled = false;
        localStorage.setItem("auto-theme-enabled", "false");
        stopSystemThemeListener();
      }

      // 设置主题并保存偏好
      localStorage.setItem("preferred-theme", themeMode);
      setThemeMode(themeMode);
      event.preventDefault();
      return;
    }

    // 颜色主题按钮
    const colorThemeBtn = event.target.closest(".color-theme-btn");
    if (colorThemeBtn) {
      const colorTheme = colorThemeBtn.getAttribute("data-color-theme");
      setColorTheme(colorTheme);
      event.preventDefault();
      return;
    }

    // 点击菜单外部关闭菜单
    const themeMenu = event.target.closest("#theme-menu");
    const themeToggleLabel = event.target.closest(
      'label[for="theme-menu-toggle"]'
    );
    if (!themeMenu && !themeToggleLabel) {
      closeThemeMenu();
    }
  };

  // 监听 checkbox 变化以生成颜色主题按钮
  // const themeMenuToggle = document.getElementById('theme-menu-toggle');

  // if (themeMenuToggle) {
  //   // 初始检查是否已选中
  //   if (themeMenuToggle.checked) {
  //     generateColorThemeButtons();
  //   }

  //   // 监听变化事件
  //   themeMenuToggle.addEventListener('change', (e) => {
  //     if (e.target.checked) {
  //       generateColorThemeButtons();
  //     }
  //   });
  // }

  PriorityScheduler.schedule(
    "generate-color-theme-buttons",
    generateColorThemeButtons,
    {
      priority: PriorityScheduler.Priority.IDLE,
    }
  );

  // 添加事件监听器
  document.addEventListener("click", handleThemeMenuClick);

  // 使用优先级调度器初始化活动状态
  PriorityScheduler.schedule("theme-initial-state", updateActiveStates, {
    priority: PriorityScheduler.Priority.LOW,
  });
})();

(function setFavicon() {
  const CONSTANT = window.CONSTANT;
  const CSSVariableListener = window.CSSVariableListener;

  const favicon = document.querySelector('link[rel="icon"][type="image/x-icon"][href="/favicon.ico"]');

  let inserted = false;

  const initFavicon = async () => {
    // <link rel="icon" id="favicon-svg" type="image/svg+xml" href="/favicon.svg"></link>

    const response = await fetch(CONSTANT.FAVICON.SVG);
    svgString = await response.text();

    return { favicon, svgString };
  };

  const updateFavicon = async () => {
    const colorTheme = CSSVariableListener.getColorTheme();
    const dataTheme = CSSVariableListener.getDataTheme();

    const { favicon, svgString } = await initFavicon();
    const iconColor = (colorTheme === 'default' && dataTheme == 'light') ?
      'black' :
      `rgb(${CSSVariableListener.get("--color-button")})`;
    const bgColor = `rgb(${CSSVariableListener.get("--color-icon-background")})`;
    const borderColor = `rgb(${CSSVariableListener.get("--color-icon-border")})`;

    updateFaviconSvg(
      { favicon, svgString },
      {
        iconColor,
        borderColor,
        bgColor,
      }
    );
    if (!inserted) {
      favicon.rel = "icon";
      favicon.type = "image/svg+xml"
      inserted = true;
    }
  };

  updateFavicon();
  window.addEventListener(CONSTANT.CUSTOM_EVENT.DATA_THEME_UPDATE, updateFavicon);
  window.addEventListener(CONSTANT.CUSTOM_EVENT.COLOR_THEME_UPDATE, updateFavicon);

  function updateFaviconSvg(
    { favicon, svgString },
    { iconColor, borderColor, bgColor }
  ) {
    // 内部通用处理函数
    const updateGroupColors = (
      svgDoc,
      groupId,
      selectors,
      attribute,
      color,
      condition
    ) => {
      const group = svgDoc.getElementById(groupId);
      if (!group) return;

      group.querySelectorAll(selectors).forEach((element) => {
        const currentValue = element.getAttribute(attribute);
        if (condition(currentValue)) {
          element.setAttribute(attribute, color);
        }
      });
    };

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, "image/svg+xml");

    // 层配置处理
    [
      {
        id: "favicon-icon",
        selectors: "path, polygon, circle, rect",
        attr: "fill",
        color: iconColor,
        condition: (val) => val && val !== "none",
      },
      {
        id: "favicon-border",
        selectors: "path, rect, circle, line",
        attr: "stroke",
        color: borderColor,
        condition: (val) => val,
      },
      {
        id: "favicon-background",
        selectors: "path, polygon, circle, rect",
        attr: "fill",
        color: bgColor,
        condition: (val) => val && val !== "none",
      },
    ].forEach((layer) =>
      updateGroupColors(
        svgDoc,
        layer.id,
        layer.selectors,
        layer.attr,
        layer.color,
        layer.condition
      )
    );

    const modifiedSvg = new XMLSerializer().serializeToString(svgDoc);

    const dataUrl = `data:image/svg+xml,${encodeURIComponent(modifiedSvg)}`;
    favicon.href = dataUrl;
  }
})();
