(function () {
  const PriorityScheduler = window.PriorityScheduler;
  const Priority = PriorityScheduler.Priority;
  const MathJaxPromise = window?.MathJax?.startup?.promise.then(() => "MathJax Initialized");

  const getNavHeight = window.NavbarDOMObserver.getHeight;

  const state = {
    activeLink: null,
    isManualClick: false,
    isInitializing: false,
    clickTargetLink: null, // 记录点击的目标链接，而不是元素
    linkMap: new Map(),
    navHeight: 0,
    scrollContainer: null,
    isUpdatingHash: false,
    firstHeading: null,
    lastScrollTop: 0, // 记录上次滚动位置
    // 缓存DOM元素
    cachedElements: {
      tocContainer: null,
      tocLinks: null
    },
    centerOnScroll: true, // 控制居中显示
    isEnabled: false, // 控制功能是否启用
    mediaQuery: null, // 媒体查询对象
    observer: null, // IntersectionObserver实例
    scrollHandler: null, // 滚动事件处理函数
  };

  // 工具函数
  const utils = {
    // 检查是否应该启用功能
    checkMediaQuery: () => {
      return window.matchMedia('only screen and (min-width: 64rem)').matches;
    },

    // 缓存和获取DOM元素
    getElement: (selector, useCache = true) => {
      const cacheKey = selector.replace(/[^a-zA-Z0-9]/g, '_');

      if (useCache && state.cachedElements[cacheKey]) {
        return state.cachedElements[cacheKey];
      }

      const element = document.querySelector(selector);
      if (useCache && element) {
        state.cachedElements[cacheKey] = element;
      }

      return element;
    },

    decodeHash: hash => {
      try {
        return decodeURIComponent(hash);
      } catch {
        return hash;
      }
    },

    findElement: id => {
      const element = document.getElementById(id);
      if (element) return element;

      try {
        return document.querySelector(`#${CSS.escape(id)}`);
      } catch {
        return document.querySelector(`[id="${id}"]`);
      }
    },

    scrollToElement: (element, smooth = true) => {
      // 使用 getBoundingClientRect 计算相对位置
      const elementRect = element.getBoundingClientRect();
      const containerRect = state.scrollContainer.getBoundingClientRect();

      // 计算元素相对于滚动容器的实际位置
      const relativeTop = elementRect.top - containerRect.top + state.scrollContainer.scrollTop;

      // 减去导航栏高度，让标题显示在导航栏下方
      // 额外减去10px让视觉效果更好
      const targetPosition = relativeTop - state.navHeight - 10;

      state.scrollContainer?.scrollTo({
        top: Math.max(0, targetPosition), // 确保不会滚动到负值
        behavior: smooth ? 'smooth' : 'auto'
      });
    },

    // 在TOC容器中居中显示指定的链接
    centerTocLink: (link) => {
      if (!link || !state.isEnabled) return;

      const tocContainer = document.getElementById('main-container-right');
      if (!tocContainer) return;

      const centerTocLink = () => {
        const linkRect = link.getBoundingClientRect();
        const containerRect = tocContainer.getBoundingClientRect();

        const linkRelativeTop = linkRect.top - containerRect.top + tocContainer.scrollTop;
        const targetPosition = linkRelativeTop - (containerRect.height - linkRect.height) / 2;

        tocContainer.scrollTo({
          top: Math.max(0, targetPosition),
          behavior: 'smooth'
        });
      }

      PriorityScheduler.schedule('centerTocLink', centerTocLink, { priority: Priority.NORMAL, delay: 100 });
    },

    updateHash: (hash) => {
      if (state.isUpdatingHash) return;

      state.isUpdatingHash = true;

      if (hash) {
        history.replaceState(null, null, hash);
      } else {
        const url = window.location.pathname + window.location.search;
        history.replaceState(null, null, url);
      }

      PriorityScheduler.schedule('updateHash_reset', () => {
        state.isUpdatingHash = false;
      }, { priority: Priority.NORMAL, delay: 50 });
    },

    // 获取当前应该激活的标题
    getCurrentActiveHeading: () => {
      const navHeight = state.navHeight;
      let currentActiveLink = null;

      // 遍历所有标题，找到最后一个在导航栏线上方或被导航栏覆盖的标题
      for (const [link, item] of state.linkMap) {
        const rect = item.element.getBoundingClientRect();

        // 如果标题的顶部在导航栏底部线上或上方（被导航栏覆盖或已经滚动过去）
        if (rect.top <= navHeight) {
          currentActiveLink = link;
        } else {
          // 一旦遇到第一个在导航栏下方的标题，就停止
          break;
        }
      }

      return currentActiveLink;
    }
  };

  // 核心功能
  const core = {
    updateActiveLink: (link, updateHash = true, centerInToc = false) => {
      // 如果启用了滚动时居中，且不是手动点击，则自动居中
      if (state.isEnabled && state.centerOnScroll && !state.isManualClick && !state.isInitializing) {
        centerInToc = true;
      }

      if (state.activeLink === link) {
        // 即使链接没有改变，如果需要居中也执行居中操作
        if (centerInToc && state.isEnabled) {
          utils.centerTocLink(link);
        }
        return;
      }

      PriorityScheduler.schedule('updateActiveLink', () => {
        // 只在功能启用时更新active类
        if (state.isEnabled) {
          state.activeLink?.classList.remove('toc-active');
          link?.classList.add('toc-active');
          state.activeLink = link;

          // 如果需要，在TOC中居中显示当前激活的链接
          if (centerInToc && link) {
            utils.centerTocLink(link);
          }
        }

        // 始终更新hash（不受媒体查询限制）
        if (updateHash && !state.isManualClick && !state.isInitializing) {
          if (link) {
            const item = state.linkMap.get(link);
            if (item) {
              utils.updateHash(item.href);
            }
          } else {
            utils.updateHash('');
          }
        }
      }, { priority: Priority.HIGH });
    },

    buildLinkMap: () => {
      // 使用缓存的tocLinks或重新查询
      const tocLinks = state.cachedElements.tocLinks ||
        document.querySelectorAll('[data-toc-link]');

      if (!state.cachedElements.tocLinks) {
        state.cachedElements.tocLinks = tocLinks;
      }

      // 清空之前的linkMap
      state.linkMap.clear();
      let firstElement = null;

      // 按照DOM顺序构建linkMap，确保顺序正确
      const linkItems = [];

      tocLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!href?.startsWith('#')) return;

        const id = utils.decodeHash(href.substring(1));
        const element = utils.findElement(id);

        if (element) {
          linkItems.push({ link, href, id, element, offsetTop: element.offsetTop });

          if (!firstElement) {
            firstElement = element;
          }
        }
      });

      // 按照页面位置排序（从上到下）
      linkItems.sort((a, b) => a.offsetTop - b.offsetTop);

      // 构建有序的linkMap
      linkItems.forEach(item => {
        state.linkMap.set(item.link, {
          href: item.href,
          id: item.id,
          element: item.element
        });
      });

      state.firstHeading = firstElement;
    },

    setupObserver: () => {
      // 清理之前的observer
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }

      const elements = [...state.linkMap.values()].map(item => item.element);
      if (!elements.length) return;

      // 创建IntersectionObserver（始终创建，用于更新hash）
      state.observer = new IntersectionObserver(entries => {
        // 在手动点击、初始化或有点击目标时不响应观察器
        if (state.isManualClick || state.isInitializing || state.clickTargetLink) return;

        // 使用修复后的逻辑确定当前活跃的标题
        const currentActive = utils.getCurrentActiveHeading();
        // 滚动时更新链接（包括hash更新）
        core.updateActiveLink(currentActive, true, state.isEnabled);

      }, {
        rootMargin: `-${state.navHeight}px 0px -50% 0px`,
        threshold: [0, 0.25, 0.5, 0.75, 1]
      });

      elements.forEach(el => state.observer.observe(el));

      // 优化滚动处理
      let ticking = false;

      state.scrollHandler = () => {
        // 在手动点击、初始化或有点击目标时完全不响应滚动事件
        if (state.isManualClick || state.isInitializing || state.clickTargetLink) {
          return;
        }

        if (!ticking) {
          PriorityScheduler.schedule('handleScroll_tick', async () => {

            if (!state.isManualClick && !state.isInitializing && !state.clickTargetLink) {
              const currentActive = utils.getCurrentActiveHeading();
              // 滚动时更新（包括hash）
              core.updateActiveLink(currentActive, true, state.isEnabled);
            }

            ticking = false;
          }, { priority: Priority.HIGH });
          ticking = true;
        }
      };

      state.scrollContainer?.addEventListener('scroll', state.scrollHandler, { passive: true });
    },

    cleanupObserver: () => {
      // 断开observer
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }

      // 移除滚动事件监听
      if (state.scrollHandler && state.scrollContainer) {
        state.scrollContainer.removeEventListener('scroll', state.scrollHandler);
        state.scrollHandler = null;
      }

      // 只在功能启用时才清除active类
      if (state.isEnabled) {
        state.linkMap.forEach((item, link) => {
          link.classList.remove('toc-active');
        });
        state.activeLink = null;
      }
    },

    handleClick: e => {
      const link = e.target.closest('[data-toc-link]');
      if (!link) return;

      e.preventDefault();
      const item = state.linkMap.get(link);
      if (!item) return;

      // 如果功能启用，执行完整的点击处理
      if (state.isEnabled) {
        state.isManualClick = true;
        state.clickTargetLink = link;

        // 立即更新激活状态到目标链接，点击时总是居中
        core.updateActiveLink(link, false, true);

        // 记录目标位置
        const targetTop = item.element.offsetTop;

        // 滚动到目标位置
        utils.scrollToElement(item.element);

        // 手动更新hash
        utils.updateHash(item.href);

        // 智能滚动完成检测
        let lastScrollPos = -1;
        let samePositionCount = 0;

        const checkScrollComplete = () => {
          const currentScrollPos = state.scrollContainer.scrollTop;
          const currentRect = item.element.getBoundingClientRect();
          const distanceToTarget = Math.abs(currentRect.top - state.navHeight);

          // 检查滚动是否停止
          if (Math.abs(currentScrollPos - lastScrollPos) < 1) {
            samePositionCount++;

            // 如果位置保持不变超过3次检查（约150ms），认为滚动完成
            if (samePositionCount > 3 || distanceToTarget < 5) {
              PriorityScheduler.cancel('checkScrollComplete');
              state.isManualClick = false;

              // 再延迟一点清除clickTargetLink，确保不会有残余的滚动
              PriorityScheduler.schedule('clearClickTarget', () => {
                if (state.clickTargetLink === link) {
                  state.clickTargetLink = null;
                }
              }, { priority: Priority.NORMAL, delay: 300 });
              return;
            }
          } else {
            samePositionCount = 0;
          }

          lastScrollPos = currentScrollPos;
        };

        // 开始定期检查（每50ms）
        PriorityScheduler.scheduleRepeating('checkScrollComplete', checkScrollComplete, 50,
          { priority: Priority.NORMAL });

        // 设置最大超时保护（3秒）
        PriorityScheduler.schedule('scrollTimeout', () => {
          PriorityScheduler.cancel('checkScrollComplete');
          state.isManualClick = false;
          if (state.clickTargetLink === link) {
            state.clickTargetLink = null;
          }
        }, { priority: Priority.NORMAL, delay: 3000 });
      } else {
        // 功能未启用时，只执行基本的滚动
        utils.scrollToElement(item.element);
        utils.updateHash(item.href);
      }
    },

    initActiveLink: async () => {
      if (state.isUpdatingHash) return;

      // 设置初始化标志
      state.isInitializing = true;
      const hash = window.location.hash;

      if (!hash) {
        // 没有hash时，根据当前滚动位置确定激活项
        const currentActive = utils.getCurrentActiveHeading();
        // 初始化时根据媒体查询状态决定是否居中
        core.updateActiveLink(currentActive, false, state.isEnabled);
        // 初始化完成
        PriorityScheduler.schedule('initComplete_noHash', () => {
          state.isInitializing = false;
        }, { priority: Priority.NORMAL, delay: 500 });
      } else {
        // 根据hash找对应链接
        const decodedHash = utils.decodeHash(hash);
        const targetLink = [...state.linkMap.entries()].find(([_, item]) =>
          item.href === hash ||
          item.href === decodedHash ||
          '#' + item.id === decodedHash
        );

        if (targetLink) {
          const [link, item] = targetLink;
          state.clickTargetLink = link;
          // 初始化时根据媒体查询状态决定是否居中
          core.updateActiveLink(link, false, state.isEnabled);

          // 确保文档完全加载后再执行滚动
          await PriorityScheduler.ensureDocumentReady();

          const raceList = [PriorityScheduler.wait('initComplete_withIdle', Priority.IDLE)];

          if (MathJaxPromise) {
            raceList[0] = raceList[0].then(() => PriorityScheduler.delay(3000));
            raceList.push(MathJaxPromise)
          };
          await Promise.race(raceList);

          utils.scrollToElement(item.element, true);

          // 滚动完成后解除初始化标志（配合平滑滚动时间）
          await PriorityScheduler.wait('initComplete_withHash', { priority: Priority.NORMAL, delay: 3000 });

          state.isInitializing = false;
          state.clickTargetLink = null;
        } else {
          // 如果找不到对应的hash，直接解除初始化标志
          await PriorityScheduler.wait('initComplete_noLink', { priority: Priority.NORMAL, delay: 500 });
          state.isInitializing = false;
        }
      }
    },

    // 响应导航栏高度变化
    handleNavHeightChange: (newHeight) => {
      if (newHeight !== state.navHeight) {
        state.navHeight = newHeight;
        // 始终重新初始化Observer（因为hash更新功能需要保持）
        if (state.linkMap.size > 0) {
          core.setupObserver();
        }
      }
    },

    // 处理媒体查询变化
    handleMediaQueryChange: () => {
      const shouldEnable = utils.checkMediaQuery();

      if (shouldEnable !== state.isEnabled) {
        state.isEnabled = shouldEnable;

        if (shouldEnable) {
          // 启用完整功能（包括active类和居中）
          core.initActiveLink();
        } else {
          // 禁用视觉功能，但保留滚动监听以更新hash
          // 清除所有active类
          state.linkMap.forEach((item, link) => {
            link.classList.remove('toc-active');
          });
          state.activeLink = null;
        }
      }
    }
  };

  // 初始化
  const init = async () => {
    state.scrollContainer = document.getElementById('scroll-container');
    state.navHeight = getNavHeight();

    // 检查初始媒体查询状态
    state.isEnabled = utils.checkMediaQuery();

    // 设置媒体查询监听
    state.mediaQuery = window.matchMedia('only screen and (min-width: 64rem)');
    state.mediaQuery.addEventListener('change', core.handleMediaQueryChange);

    await PriorityScheduler.wait('init_main', { priority: Priority.LOW, timeout: 50 });

    core.buildLinkMap();

    if (state.linkMap.size > 0) {
      // 始终设置Observer（用于更新hash）
      core.setupObserver();

      // 根据媒体查询状态初始化
      core.initActiveLink();

      // 始终添加点击事件监听（即使在小屏幕上也需要响应点击）
      state.cachedElements.tocContainer = utils.getElement('#toc-nav');
      state.cachedElements.tocContainer?.addEventListener('click', core.handleClick);
    }

    // 监听导航栏高度变化事件
    window.addEventListener('dom:navHeightChanged', (e) => {
      core.handleNavHeightChange(e.detail.height);
    });
  };

  // 启动
  PriorityScheduler.schedule('init_startup', init,
    { priority: Priority.LOW, timeout: 100 });

  window.addEventListener('hashchange', () => {
    if (!state.isUpdatingHash) {
      core.initActiveLink();
    }
  });

})();