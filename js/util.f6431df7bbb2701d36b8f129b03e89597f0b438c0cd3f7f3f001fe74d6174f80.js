// 简化的 MathJax 配置 - 基本功能
window.MathJax = {
  // 加载必要的组件
  loader: {
    load: ["input/tex", "output/svg"],
  },

  // TeX 输入配置
  tex: {
    inlineMath: [["$", "$"]],
    displayMath: [["$$", "$$"]],
    processEscapes: true,
  },

  // SVG 输出配置
  svg: {
    fontCache: "global",
  },
};

// RequestIdleCallback polyfill
(() => {
  if (!("requestIdleCallback" in window)) {
    window.requestIdleCallback = (callback) => {
      const start = Date.now();
      return setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        });
      }, 1);
    };
  }

  if (!("cancelIdleCallback" in window)) {
    window.cancelIdleCallback = (id) => clearTimeout(id);
  }
})();

class Util {
  static trueRandom = (max) => {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const trueRandom = Math.floor((array[0] / 0xffffffff) * max);
    return trueRandom;
  };

  // 检测是否支持 attributeStyleMap
  static supportsStyleMap =
    typeof CSS !== "undefined" &&
    CSS.supports &&
    "attributeStyleMap" in Element.prototype;

  // 格式化数值方法
  // 确保所有数值样式值最多保留3位小数，避免精度问题
  static formatValue(value, unit = "") {
    if (typeof value !== "number") return value;

    // 整数直接返回，无需格式化
    if (Number.isInteger(value)) {
      return value + unit;
    }

    // 小数保留最多3位，并移除末尾无意义的0
    const formatted = parseFloat(value.toFixed(3));
    return formatted + unit;
  }

  // 创建 StyleMap 兼容对象
  static createAttributeStyleMap(element) {
    if (this.supportsStyleMap) {
      // 原生支持，直接返回
      return element.attributeStyleMap;
    }

    // 创建兼容对象，模拟 attributeStyleMap API
    return {
      setProperty(prop, value) {
        element.style.setProperty(prop, value);
      },

      removeProperty(prop) {
        element.style.removeProperty(prop);
      },

      clean() {
        // 清除所有 CSS 变量
        const computed = getComputedStyle(element);
        for (const prop of computed) {
          if (prop.startsWith("--")) {
            element.style.removeProperty(prop);
          }
        }
      },
    };
  }
}

window.Util = Util;

class LifecycleManager {
  constructor() {
    this.handlers = [];

    window.addEventListener('beforeunload', () => this.handleBeforeUnload());
  }

  register = (handler) => {
    this.handlers.push(handler);
  };

  handleBeforeUnload = () => {
    while (this.handlers.length > 0) {
      const handler = this.handlers.pop();
      handler();
    }
  };
}

// 导出类
window.LifeCycleManager = new LifecycleManager();

// 优先级任务调度器类
class PriorityScheduler {
  // 静态优先级枚举
  static Priority = Object.freeze({
    IMMEDIATE: "immediate", // 立即执行 - 微任务
    HIGH: "high", // 高优先级 - RAF
    NORMAL: "normal", // 普通优先级 - RAF with delay
    LOW: "low", // 低优先级 - requestIdleCallback
    IDLE: "idle", // 空闲时执行 - requestIdleCallback with timeout
  });

  // 静态优先级排序映射
  static priorityOrder = {
    [PriorityScheduler.Priority.IMMEDIATE]: 0,
    [PriorityScheduler.Priority.HIGH]: 1,
    [PriorityScheduler.Priority.NORMAL]: 2,
    [PriorityScheduler.Priority.LOW]: 3,
    [PriorityScheduler.Priority.IDLE]: 4,
  };

  static fakeIdleDeadline = Object.freeze({
    didTimeout: false,
    timeRemaining: () => Infinity,
  });

  constructor() {
    // 私有任务存储
    this._tasks = new Map();
  }

  // 暴露优先级枚举（实例属性）
  get Priority() {
    return PriorityScheduler.Priority;
  }

  // 确保文档就绪 - 支持回调和Promise两种方式
  ensureDocumentReady = (callback) => {
    const promise = Promise.all([
      new Promise((resolve) => {
        if (document.readyState === "complete") {
          resolve();
        } else if (document.readyState === "interactive") {
          window.addEventListener("load", resolve, { once: true });
        } else {
          if (document.readyState === "loading") {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                if (document.readyState === "complete") {
                  resolve();
                } else {
                  window.addEventListener("load", resolve, { once: true });
                }
              },
              { once: true }
            );
          }
        }
      }),
      Promise.race([
        this.delay(3000),
        new Promise((resolve) =>
          window?.i18n.isLoaded() ?
            resolve() :
            window.addEventListener("i18n:ready", resolve, { once: true })
        ).then(() => {
          console.log("i18n:ready")
        }),
      ]),
    ]);

    // 如果提供了回调函数，使用回调模式
    if (typeof callback === "function") {
      promise.then(callback);
      return;
    }

    // 否则返回Promise用于await
    return promise;
  };

  // 异步调度任务 - 返回Promise
  wait = (id, options = {}) => {
    const { priority, delay, timeout } = options;

    return new Promise((resolve, reject) => {
      try {
        // 创建一个包装回调，在执行完成后resolve Promise
        const wrappedCallback = (deadline) => {
          try {
            resolve(deadline?.timeRemaining?.() ?? Infinity);
          } catch (error) {
            reject(error);
          }
        };

        // 使用现有的schedule方法，但传入包装后的回调
        this.schedule(id, wrappedCallback, { priority, delay, timeout });
      } catch (error) {
        reject(error);
      }
    });
  };

  delay = (ms, value) => new Promise((res) => setTimeout(() => res(value), ms));

  // 调度单次任务
  schedule = (id, callback, options = {}) => {
    const {
      priority = PriorityScheduler.Priority.NORMAL,
      delay = 0,
      timeout = Infinity,
    } = options;

    // 取消之前的任务
    this.cancel(id);

    const task = { id, callback, priority, delay, timeout, type: "once" };
    this._tasks.set(id, task);

    switch (priority) {
      case PriorityScheduler.Priority.IMMEDIATE:
        task.handle = Promise.resolve().then(() => {
          if (this._tasks.has(id)) {
            callback(PriorityScheduler.fakeIdleDeadline);
            this._tasks.delete(id);
          }
        });
        break;

      case PriorityScheduler.Priority.HIGH:
        task.handle = requestAnimationFrame(() => {
          if (this._tasks.has(id)) {
            callback(PriorityScheduler.fakeIdleDeadline);
            this._tasks.delete(id);
          }
        });
        break;

      case PriorityScheduler.Priority.NORMAL:
        if (delay === 0) {
          task.handle = requestAnimationFrame(() => {
            if (this._tasks.has(id)) {
              callback(PriorityScheduler.fakeIdleDeadline);
              this._tasks.delete(id);
            }
          });
        } else {
          const startTime = performance.now();
          const tick = (currentTime) => {
            if (currentTime - startTime >= delay) {
              if (this._tasks.has(id)) {
                callback(PriorityScheduler.fakeIdleDeadline);
                this._tasks.delete(id);
              }
            } else {
              task.handle = requestAnimationFrame(tick);
            }
          };
          task.handle = requestAnimationFrame(tick);
        }
        break;

      case PriorityScheduler.Priority.LOW:
        task.timeout = Math.min(task.timeout, 500);
      // 故意不 break，继续执行 IDLE 的逻辑
      case PriorityScheduler.Priority.IDLE:
        task.handle = requestIdleCallback(
          (idleDeadline) => {
            if (this._tasks.has(id)) {
              callback(idleDeadline);
              this._tasks.delete(id);
            }
          },
          { timeout: task.timeout }
        );
        break;
    }

    return id;
  };

  // 调度周期性任务
  // 调度周期性任务
  scheduleRepeating = (id, callback, interval, options = {}) => {
    const { priority = PriorityScheduler.Priority.NORMAL, maxRuns = Infinity } =
      options;

    // 取消之前的任务
    this.cancel(id);

    const task = {
      id,
      callback,
      priority,
      interval,
      type: "repeating",
      maxRuns,
      runCount: 0,
    };
    this._tasks.set(id, task);

    let lastTime = performance.now();

    // 使用箭头函数确保 this 绑定
    const executeTask = () => {
      const currentTime = performance.now();

      if (
        priority === PriorityScheduler.Priority.LOW ||
        priority === PriorityScheduler.Priority.IDLE
      ) {
        // 低优先级任务
        task.handle = requestIdleCallback((idleDeadline) => {
          if (this._tasks.has(id) && currentTime - lastTime >= interval) {
            callback(idleDeadline);
            lastTime = currentTime;
            task.runCount++;

            // 检查是否达到最大运行次数
            if (task.runCount >= task.maxRuns) {
              this._tasks.delete(id);
              return;
            }
          }
          if (this._tasks.has(id)) {
            executeTask();
          }
        });
      } else {
        // 高优先级和普通优先级任务
        if (currentTime - lastTime >= interval) {
          callback(PriorityScheduler.fakeIdleDeadline);
          lastTime = currentTime;
          task.runCount++;

          // 检查是否达到最大运行次数
          if (task.runCount >= task.maxRuns) {
            this._tasks.delete(id);
            return;
          }
        }
        if (this._tasks.has(id)) {
          task.handle = requestAnimationFrame(executeTask);
        }
      }
    };

    executeTask();
    return id;
  };

  // 批量调度任务
  scheduleBatch = (taskList) => {
    // 按优先级排序
    const sortedTasks = [...taskList].sort((a, b) => {
      const aPriority = a.priority || PriorityScheduler.Priority.NORMAL;
      const bPriority = b.priority || PriorityScheduler.Priority.NORMAL;
      return (
        PriorityScheduler.priorityOrder[aPriority] -
        PriorityScheduler.priorityOrder[bPriority]
      );
    });

    // 调度所有任务
    return sortedTasks.map((task) => {
      const id = task.id || `batch_${Date.now()}_${Math.random()}`;
      return this.schedule(id, task.callback, task);
    });
  };

  // 批量异步调度 - 返回Promise数组
  scheduleBatchAsync = (taskList) => {
    // 按优先级排序
    const sortedTasks = [...taskList].sort((a, b) => {
      const aPriority = a.priority || PriorityScheduler.Priority.NORMAL;
      const bPriority = b.priority || PriorityScheduler.Priority.NORMAL;
      return (
        PriorityScheduler.priorityOrder[aPriority] -
        PriorityScheduler.priorityOrder[bPriority]
      );
    });

    // 调度所有任务并返回Promise数组
    return sortedTasks.map((task) => {
      const id = task.id || `batch_${Date.now()}_${Math.random()}`;
      return this.wait(id, task);
    });
  };

  // 取消任务
  cancel = (id) => {
    const task = this._tasks.get(id);
    if (!task) return;

    if (task.handle) {
      switch (task.priority) {
        case PriorityScheduler.Priority.HIGH:
        case PriorityScheduler.Priority.NORMAL:
          cancelAnimationFrame(task.handle);
          break;
        case PriorityScheduler.Priority.LOW:
        case PriorityScheduler.Priority.IDLE:
          cancelIdleCallback(task.handle);
          break;
        // IMMEDIATE 使用 Promise，无法取消
      }
    }

    this._tasks.delete(id);
  };

  // 取消所有任务
  cancelAll = () => {
    this._tasks.forEach((_, id) => this.cancel(id));
  };

  // 获取当前任务数量
  getTaskCount = () => {
    return this._tasks.size;
  };

  // 判断任务是否存在
  hasTask = (id) => {
    return this._tasks.has(id);
  };

  // 获取任务信息
  getTask = (id) => {
    const task = this._tasks.get(id);
    if (!task) return null;

    return {
      id: task.id,
      priority: task.priority,
      type: task.type,
      interval: task.interval,
    };
  };

  // 获取所有任务ID
  getAllTaskIds = () => {
    return Array.from(this._tasks.keys());
  };
}

// 创建全局实例
window.PriorityScheduler = new PriorityScheduler();

class CacheManager {
  #db = null;
  #initPromise = null;
  #dbName = 'CacheDB';
  #storeName = 'cache';
  #expiry = 24 * 60 * 60 * 1000;
  #version = '1.0.0';
  #buildHash = '';
  #isSupported = false;

  constructor(config = {}) {
    this.#dbName = config.dbName || this.#dbName;
    this.#storeName = config.storeName || this.#storeName;
    this.#expiry = config.expiry ?? this.#expiry;
    this.#version = config.version || this.#version;

    if (typeof window !== 'undefined') {
      this.#buildHash = config.buildHash || window.BUILD_HASH || '';
      this.#isSupported = this.#checkSupport();

      if (this.#isSupported) {
        this.#initPromise = this.#init();
      } else {
        console.warn('IndexedDB not supported');
      }

      window.LifeCycleManager?.register(this.closeDatabase.bind(this));
    }
  }

  #checkSupport = () => {
    try {
      return !!window.indexedDB;
    } catch (e) {
      return false;
    }
  }

  #init = async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#dbName, 3);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.#db = request.result;
        this.#clearOldEntries().then(() => {
          console.log(`CacheManager initialized (v${this.#version})`);
          resolve();
        });
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains(this.#storeName)) {
          db.deleteObjectStore(this.#storeName);
        }
        const store = db.createObjectStore(this.#storeName, { keyPath: 'id' });
        store.createIndex('buildHash', 'buildHash', { unique: false });
        store.createIndex('version', 'version', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      };
    });
  }

  #clearOldEntries = async () => {
    if (!this.#db) return;

    return new Promise((resolve) => {
      const tx = this.#db.transaction(this.#storeName, 'readwrite');
      const store = tx.objectStore(this.#storeName);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;
          // 修复: 检查游标值是否存在
          if (entry) {
            // 修复: 加入版本判断逻辑
            if (this.#compareVersions(entry.version, this.#version) < 0 ||
              entry.buildHash !== this.#buildHash) {
              cursor.delete();
            }
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        console.error('清除旧缓存失败');
        resolve();
      };
    });
  }

  #compareVersions = (v1, v2) => {
    const parts1 = (v1 || '0.0.0').split('.').map(Number);
    const parts2 = (v2 || '0.0.0').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 !== num2) return num1 - num2;
    }
    return 0;
  }

  #ensureReady = async () => {
    if (!this.#isSupported) return false;
    if (!this.#db) {
      try {
        await this.#initPromise;
      } catch (e) {
        console.error('数据库初始化失败', e);
        return false;
      }
    }
    return !!this.#db;
  }

  #isEntryValid = (entry) => {
    if (!entry) return false;
    if (entry.buildHash !== this.#buildHash) return false;
    if (this.#compareVersions(entry.version, this.#version) < 0) return false;
    return this.#expiry < 0 || (Date.now() - entry.timestamp <= this.#expiry);
  }

  async save(key, data) {
    if (!await this.#ensureReady()) return false;

    try {
      const tx = this.#db.transaction(this.#storeName, 'readwrite');
      const store = tx.objectStore(this.#storeName);

      await new Promise((resolve, reject) => {
        const request = store.put({
          id: key,
          data,
          timestamp: Date.now(),
          buildHash: this.#buildHash,
          version: this.#version
        });

        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });

      return true;
    } catch (error) {
      console.error(`保存失败: ${key}`, error);
      return false;
    }
  }

  async load(key) {
    if (!await this.#ensureReady()) return null;

    try {
      const tx = this.#db.transaction(this.#storeName, 'readonly');
      const store = tx.objectStore(this.#storeName);

      const entry = await new Promise((resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });

      if (entry && this.#isEntryValid(entry)) {
        return entry.data;
      }

      if (entry) {
        await this.delete(key);
      }
      return null;
    } catch (error) {
      console.error(`加载失败: ${key}`, error);
      return null;
    }
  }

  async delete(key) {
    if (!await this.#ensureReady()) return false;

    try {
      const tx = this.#db.transaction(this.#storeName, 'readwrite');
      const store = tx.objectStore(this.#storeName);

      await new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });

      return true;
    } catch (error) {
      console.error(`删除失败: ${key}`, error);
      return false;
    }
  }

  async closeDatabase() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
      return true;
    }
    return false;
  }

  getVersion() {
    return this.#version;
  }

  async isValid(key) {
    if (!await this.#ensureReady()) return false;

    try {
      const tx = this.#db.transaction(this.#storeName, 'readonly');
      const store = tx.objectStore(this.#storeName);

      const entry = await new Promise((resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });

      return this.#isEntryValid(entry);
    } catch (error) {
      console.error(`验证失败: ${key}`, error);
      return false;
    }
  }

  async getStats() {
    if (!await this.#ensureReady()) return 0;

    try {
      const tx = this.#db.transaction(this.#storeName, 'readonly');
      const store = tx.objectStore(this.#storeName);

      return await new Promise((resolve) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    } catch (error) {
      console.error('获取统计失败', error);
      return 0;
    }
  }

  async getAllCacheEntries() {
    if (!await this.#ensureReady()) return [];

    try {
      const tx = this.#db.transaction(this.#storeName, 'readonly');
      const store = tx.objectStore(this.#storeName);

      return await new Promise((resolve) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      });
    } catch (error) {
      console.error('获取所有缓存失败', error);
      return [];
    }
  }
}

window.CacheManager = CacheManager;