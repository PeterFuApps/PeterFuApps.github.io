// 回到顶部
(function setupScrollToTop() {
  const PriorityScheduler = window.PriorityScheduler;

  const scrollButton = document.getElementById('scroll-to-top');
  const scrollContainer = document.getElementById('scroll-container');

  if (!scrollButton || !scrollContainer) return;

  // 配置
  const showThreshold = 200; // 显示按钮的滚动阈值

  // 状态变量
  let buttonVisible = false;  // 按钮可见状态

  // 更新按钮可见性
  const updateButtonVisibility = () => {
    const scrollTop = scrollContainer.scrollTop;
    const shouldBeVisible = scrollTop > showThreshold;

    if (shouldBeVisible !== buttonVisible) {
      buttonVisible = shouldBeVisible;

      if (buttonVisible) {
        // 显示按钮
        scrollButton.classList.remove('invisible', 'opacity-0');
        scrollButton.classList.add('opacity-100');
      } else {
        // 隐藏按钮
        scrollButton.classList.add('invisible', 'opacity-0');
        scrollButton.classList.remove('opacity-100');
      }
    }
  };

  // 使用优先级调度器处理滚动事件
  const handleScroll = () => {
    PriorityScheduler.schedule('scroll-to-top-visibility', updateButtonVisibility, {
      priority: PriorityScheduler.Priority.HIGH // 使用高优先级确保UI响应流畅
    });
  };

  // 平滑滚动到顶部
  const smoothScrollToTop = () => {
    if (scrollContainer.scrollTop <= 0) return;

    scrollContainer.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // 按钮点击事件
  const handleButtonClick = (e) => {
    e.preventDefault();
    smoothScrollToTop();
  };

  // 键盘支持
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      smoothScrollToTop();
    }
  };

  // 添加事件监听器
  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  scrollButton.addEventListener('click', handleButtonClick);
  scrollButton.addEventListener('keydown', handleKeyDown);

  // 初始化按钮状态
  updateButtonVisibility();

  // 清理函数（可选，如果需要的话）
  window.addEventListener('beforeunload', () => {
    PriorityScheduler.cancel('scroll-to-top-visibility');
  });
})();

// 导航栏边框处理和滚动条隐藏
(function setupNavBorderAndScrollbar() {
  const PriorityScheduler = window.PriorityScheduler;

  const nav = document.querySelector('nav');
  const scrollContainer = document.getElementById('scroll-container');

  if (!nav || !scrollContainer) return;

  // 获取导航栏高度函数
  const getNavHeight = window.NavbarDOMObserver.getHeight;

  // 状态变量
  let isAtTop = true; // 是否在顶部的状态
  let scrollbarHidden = true; // 滚动条是否已隐藏
  let cachedNavHeight = getNavHeight(); // 缓存导航栏高度
  let navBorderThreshold = cachedNavHeight; // 触发导航栏边框显示的滚动阈值
  let scrollbarHideThreshold = cachedNavHeight; // 触发滚动条隐藏的阈值

  // 更新导航栏边框
  const updateNavBorder = (scrollTop) => {
    const shouldDisplayPanelMaterial = scrollTop < navBorderThreshold;

    if (shouldDisplayPanelMaterial !== isAtTop) {
      isAtTop = shouldDisplayPanelMaterial;

      if (isAtTop) {
        nav.classList.remove('ui-panel-material');
      } else {
        nav.classList.add('ui-panel-material');
      }
    }
  };

  // 更新滚动条显示状态
  const updateScrollbarVisibility = (scrollTop) => {
    const shouldHideScrollbar = scrollTop <= scrollbarHideThreshold;

    if (shouldHideScrollbar !== scrollbarHidden) {
      scrollbarHidden = shouldHideScrollbar;

      if (scrollbarHidden) {
        scrollContainer.classList.add('scrollbar-none');
      } else {
        scrollContainer.classList.remove('scrollbar-none');
      }
    }
  };

  // 统一的更新函数
  const updateScrollState = () => {
    const scrollTop = scrollContainer.scrollTop;
    updateNavBorder(scrollTop);
    updateScrollbarVisibility(scrollTop);
  };

  // 使用优先级调度器处理滚动事件
  const handleScroll = () => {
    PriorityScheduler.schedule('nav-scrollbar-update', updateScrollState, {
      priority: PriorityScheduler.Priority.HIGH // 高优先级保证UI更新流畅
    });
  };

  // 处理窗口大小变化
  const handleResize = () => {
    PriorityScheduler.schedule('nav-scrollbar-resize', updateScrollState, {
      priority: PriorityScheduler.Priority.NORMAL
    });
  };

  // 处理导航栏高度变化
  const handleNavHeightChanged = () => {
    console.log("changed")
    // 更新缓存的导航栏高度和所有阈值
    cachedNavHeight = getNavHeight();
    navBorderThreshold = cachedNavHeight;
    scrollbarHideThreshold = cachedNavHeight;

    PriorityScheduler.schedule('nav-height-changed', updateScrollState, {
      priority: PriorityScheduler.Priority.HIGH
    });
  };

  // 使用 ResizeObserver 监听容器变化
  const resizeObserver = new ResizeObserver(() => {
    handleResize();
  });

  // 开始观察滚动容器
  resizeObserver.observe(scrollContainer);

  // 监听滚动事件
  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

  // 监听导航栏高度变化事件
  window.addEventListener('dom:navHeightChanged', handleNavHeightChanged);

  // 初始化状态
  updateScrollState();

  // 确保页面加载时顶部状态正确（隐藏滚动条）
  PriorityScheduler.schedule('initial-scrollbar-check', () => {
    const initialScrollTop = scrollContainer.scrollTop;
    if (initialScrollTop <= scrollbarHideThreshold) {
      scrollContainer.classList.add('scrollbar-none');
    }
  }, {
    priority: PriorityScheduler.Priority.LOW
  });
})();