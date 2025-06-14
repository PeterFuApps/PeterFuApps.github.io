// 语法兼容性检测
(async function featureDetect() {
  const PriorityScheduler = window.PriorityScheduler;
  
  const checkCompatibility = () => {
    const supportsNesting = CSS?.supports?.('selector(&:hover)') ?? false;
    if (!supportsNesting) {
      return;
      // alert(`目前博客为预览模式，您的浏览器版本较低，不支持 @layer 语法，请使用\nChrome/Edge 112+ (2023年2月)\nFirefox 113+ (2023年4月)\nSafari 16.5+ (2022年4月)`);
    }
  };

  // 使用异步优先级调度器进行检测
  await PriorityScheduler.wait('compatibility-check', {
    priority: PriorityScheduler.Priority.IDLE
  });
  
  checkCompatibility();
})();

// 设置版权年份
(async function setupCopyright() {
  const PriorityScheduler = window.PriorityScheduler;
  
  const updateCopyright = () => {
    const copyrightEl = document.querySelector("#copyright");
    if (copyrightEl) {
      copyrightEl.textContent = new Date().getFullYear();
    }
  };

  await PriorityScheduler.wait('copyright-update', {
    priority: PriorityScheduler.Priority.LOW
  });
  
  updateCopyright();
})();

// noscript 控制 transition，延迟一段时间后执行以防止闪烁
(async function () {
  const PriorityScheduler = window.PriorityScheduler;

  // 获取 html 元素并移除 noscript 属性
  const prev = Date.now();
  
  const removeNoscript = () => {
    const curr = Date.now();
    const htmlElement = document.documentElement;
    if (htmlElement.hasAttribute('noscript')) {
      htmlElement.removeAttribute('noscript');
    }
    console.log("latency", curr - prev);
  };

  await PriorityScheduler.wait('remove-noscript', {
    priority: PriorityScheduler.Priority.IDLE
  });
  
  removeNoscript();
})();