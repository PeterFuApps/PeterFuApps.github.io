// Go 日期格式化器 - 基于 Go 语言的原始算法
class GoDateFormatter {
  // 格式化日期
  static format(date, formatString = '2006-01-02') {
    if (!date) return '';

    const dateObj = date instanceof Date ? date : new Date(date);

    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid date provided to GoDateFormatter');
      return '';
    }

    // 从左到右扫描格式字符串
    let result = '';
    let i = 0;

    while (i < formatString.length) {
      // 尝试匹配最长的格式模式
      let matched = false;
      let maxLength = Math.min(10, formatString.length - i); // 最长的格式模式长度

      // 从最长可能的匹配开始尝试
      for (let len = maxLength; len > 0; len--) {
        const substr = formatString.substring(i, i + len);
        const value = this.#getFormatValue(substr, dateObj);

        if (value !== null) {
          result += value;
          i += len;
          matched = true;
          break;
        }
      }

      // 如果没有匹配，则将当前字符作为字面量
      if (!matched) {
        result += formatString[i];
        i++;
      }
    }

    return result;
  }

  // 根据格式模式获取对应的值
  static #getFormatValue(pattern, date) {
    switch (pattern) {
      // 年份
      case '2006': return date.getFullYear().toString().padStart(4, '0');
      case '06': return date.getFullYear().toString().slice(-2).padStart(2, '0');

      // 月份
      case 'January': return date.toLocaleDateString('en-US', { month: 'long' });
      case 'Jan': return date.toLocaleDateString('en-US', { month: 'short' });
      case '01': return (date.getMonth() + 1).toString().padStart(2, '0');
      case '1': return (date.getMonth() + 1).toString();

      // 日期
      case '02': return date.getDate().toString().padStart(2, '0');
      case '2': return date.getDate().toString();
      case '_2': return date.getDate().toString().padStart(2, ' ');

      // 星期
      case 'Monday': return date.toLocaleDateString('en-US', { weekday: 'long' });
      case 'Mon': return date.toLocaleDateString('en-US', { weekday: 'short' });

      // 小时
      case '15': return date.getHours().toString().padStart(2, '0');
      case '03': return ((date.getHours() % 12) || 12).toString().padStart(2, '0');
      case '3': return ((date.getHours() % 12) || 12).toString();

      // 分钟
      case '04': return date.getMinutes().toString().padStart(2, '0');
      case '4': return date.getMinutes().toString();

      // 秒
      case '05': return date.getSeconds().toString().padStart(2, '0');
      case '5': return date.getSeconds().toString();

      // 亚秒
      case '.000000000': return '.' + (date.getMilliseconds() * 1000000).toString().padStart(9, '0');
      case '.000000': return '.' + (date.getMilliseconds() * 1000).toString().padStart(6, '0');
      case '.000': return '.' + date.getMilliseconds().toString().padStart(3, '0');
      case '.999999999': {
        const ms = date.getMilliseconds();
        return ms ? '.' + (ms * 1000000).toString().replace(/0+$/, '') : '';
      }
      case '.999999': {
        const ms = date.getMilliseconds();
        return ms ? '.' + (ms * 1000).toString().replace(/0+$/, '') : '';
      }
      case '.999': {
        const ms = date.getMilliseconds();
        return ms ? '.' + ms.toString().replace(/0+$/, '') : '';
      }

      // AM/PM
      case 'PM': return date.getHours() >= 12 ? 'PM' : 'AM';
      case 'pm': return date.getHours() >= 12 ? 'pm' : 'am';

      // 时区
      case 'Z07:00': {
        const offset = this.#getTimezoneOffset(date);
        return offset === '+00:00' ? 'Z' : offset;
      }
      case 'Z0700': {
        const offset = this.#getTimezoneOffsetNoColon(date);
        return offset === '+0000' ? 'Z' : offset;
      }
      case '-07:00': return this.#getTimezoneOffset(date);
      case '-0700': return this.#getTimezoneOffsetNoColon(date);
      case '-07': return this.#getTimezoneHour(date);

      // 时区名称
      case 'MST': {
        try {
          const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date);
          return parts.find(part => part.type === 'timeZoneName')?.value || '';
        } catch {
          return '';
        }
      }

      default:
        return null;
    }
  }

  // 辅助方法：获取时区偏移（带冒号）
  static #getTimezoneOffset(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60).toString().padStart(2, '0');
    const minutes = (absOffset % 60).toString().padStart(2, '0');
    return sign + hours + ':' + minutes;
  }

  // 辅助方法：获取时区偏移（不带冒号）
  static #getTimezoneOffsetNoColon(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60).toString().padStart(2, '0');
    const minutes = (absOffset % 60).toString().padStart(2, '0');
    return sign + hours + minutes;
  }

  // 辅助方法：获取时区小时
  static #getTimezoneHour(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
    return sign + hours;
  }
}

// I18N 主类
class I18N {
  #translations = new Map();
  #currentLang = 'en';
  #defaultLang = 'en';
  #defaultTranslations = {}; // 存储默认语言的翻译
  #availableLanguages = new Set(['en']);
  #config = {};
  #debug = false;
  #initialized = false;
  #cachePrefix = 'i18n_cache_'; // localStorage 缓存前缀
  #buildHashKey = 'i18n_build_hash'; // BUILD_HASH 存储键

  #loaded = false; // 添加加载状态锁

  constructor(options = {}) {
    const { debug = false } = options;
    this.#debug = debug;
    this.#init();
  }

  // 私有初始化方法
  async #init(targetLang = null) {
    // 设置加载锁
    this.#loaded = false;

    try {
      // 加载默认配置
      const defaultData = await this.#loadWithCache();

      this.#config = defaultData.config ?? {};
      this.#availableLanguages = new Set(defaultData.language?.available ?? ['en']);
      this.#defaultLang = defaultData.language?.current ?? 'en';

      // 保存默认翻译以备后用
      this.#defaultTranslations = defaultData.translations ?? {};

      // 确定目标语言
      const requestedLang = targetLang ?? this.#defaultLang;
      this.#currentLang = this.#availableLanguages.has(requestedLang)
        ? requestedLang
        : this.#defaultLang;

      // 加载翻译
      await this.#loadTranslations(this.#currentLang);

      this.#initialized = true;

      if (this.#debug) {
        this.#logDebug('i18n initialized', {
          language: this.#currentLang,
          defaultLanguage: this.#defaultLang,
          availableLanguages: [...this.#availableLanguages],
          translationsCount: this.#translations.size,
          config: this.#config
        });
      }

      // 触发初始化完成事件
      this.#dispatchEvent('i18n:ready', {
        language: this.#currentLang,
        availableLanguages: [...this.#availableLanguages]
      });

      return true;
    } catch (error) {
      console.error('i18n initialization failed:', error);
      this.#initialized = false;
      return false;
    } finally {
      // 释放加载锁
      this.#loaded = true;
    }
  }

  // 带缓存的加载方法
  async #loadWithCache(targetLang) {
    // 如果没有提供 targetLang，使用默认语言
    const isDefault = !targetLang || targetLang === this.#defaultLang;
    const url = isDefault ? '/i18n/i18n.json' : `/${targetLang}/i18n/i18n.json`;
    const cacheKey = isDefault ? 'default' : `lang_${targetLang}`;

    const currentBuildHash = window.BUILD_HASH;
    const storedBuildHash = localStorage.getItem(this.#buildHashKey);
    const fullCacheKey = this.#cachePrefix + cacheKey;

    // 检查 BUILD_HASH 是否变化
    if (currentBuildHash !== storedBuildHash) {
      if (this.#debug) {
        this.#logDebug('BUILD_HASH changed, clearing cache', {
          old: storedBuildHash,
          new: currentBuildHash
        });
      }
      this.#clearAllCache();
      localStorage.setItem(this.#buildHashKey, currentBuildHash);
    }

    // 尝试从缓存获取
    const cachedData = this.#getCachedData(fullCacheKey);
    if (cachedData) {
      if (this.#debug) {
        this.#logDebug('Loading from cache', { targetLang: targetLang || 'default', cacheKey });
      }
      return cachedData;
    }

    // 从网络获取
    const data = await this.#fetchJSON(url);

    // 存入缓存
    this.#setCachedData(fullCacheKey, data);

    return data;
  }

  // 从 localStorage 获取缓存数据
  #getCachedData(key) {
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Failed to read cache:', error);
    }
    return null;
  }

  // 设置缓存数据到 localStorage
  #setCachedData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save cache:', error);
      // 如果存储失败（比如超出配额），尝试清理旧缓存
      if (error.name === 'QuotaExceededError') {
        this.#clearAllCache();
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch (retryError) {
          console.error('Failed to save cache after cleanup:', retryError);
        }
      }
    }
  }

  // 清除所有 i18n 相关缓存
  #clearAllCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.#cachePrefix)) {
        keys.push(key);
      }
    }
    keys.forEach(key => localStorage.removeItem(key));
  }

  // 加载翻译文件
  async #loadTranslations(targetLang) {
    if (targetLang === this.#defaultLang) {
      this.#setTranslations(this.#defaultTranslations);
      return;
    }

    try {
      const langData = await this.#loadWithCache(targetLang);
      this.#setTranslations(langData.translations ?? {});
    } catch (error) {
      console.warn(`Failed to load ${targetLang} translations, falling back to default`);
      this.#currentLang = this.#defaultLang;
      this.#setTranslations(this.#defaultTranslations);
    }
  }

  // 辅助方法：获取 JSON
  async #fetchJSON(url) {
    // 自动添加 BUILD_HASH 参数
    const separator = url.includes('?') ? '&' : '?';
    const finalUrl = `${url}${separator}hash=${window.BUILD_HASH}`;

    const response = await fetch(finalUrl);
    if (!response.ok) {
      throw new Error(`Failed to load: ${url}`);
    }
    return response.json();
  }

  // 设置翻译
  #setTranslations(translations) {
    this.#translations.clear();
    Object.entries(translations).forEach(([key, value]) => {
      this.#translations.set(key, value);
    });
  }

  // 辅助方法：派发事件
  #dispatchEvent(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  // 辅助方法：调试日志
  #logDebug(message, data) {
    if (this.#debug) {
      console.log(`[i18n] ${message}:`, data);
    }
  }

  // 公共方法：获取翻译（加载期间返回 key 或占位符）
  t = (key, params = {}) => {
    // 如果正在加载，返回 key 或加载提示
    if (!this.#loaded) {
      if (this.#debug) {
        console.warn(`i18n is loading, returning key: ${key}`);
      }
      return key; // 或者返回 'Loading...' 之类的占位符
    }

    if (!this.#initialized) {
      console.warn('i18n not initialized yet');
      return key;
    }

    const translation = this.#translations.get(key);

    if (!translation) {
      if (this.#debug) {
        console.warn(`Translation missing for key: ${key}`);
      }
      return key;
    }

    // 使用模板替换参数
    return Object.entries(params).reduce((result, [paramKey, value]) => {
      const regex = new RegExp(`{{\\s*${paramKey}\\s*}}`, 'g');
      return result.replace(regex, String(value));
    }, translation);
  };

  // 切换语言
  switchLanguage = async (lang) => {
    if (lang === this.#currentLang) return true;

    if (!this.isLanguageAvailable(lang)) {
      console.warn(`Language '${lang}' is not available. Available languages:`, [...this.#availableLanguages]);
      return false;
    }

    // 设置加载锁
    this.#loaded = false;
    this.#dispatchEvent('i18n:loading', { from: this.#currentLang, to: lang });

    const oldLang = this.#currentLang;
    const initialized = await this.#init(lang);

    if (initialized) {
      this.#dispatchEvent('i18n:languageChanged', { from: oldLang, to: lang });
    }

    return initialized;
  };

  // 手动清除缓存
  clearCache = () => {
    this.#clearAllCache();
    localStorage.removeItem(this.#buildHashKey);
    if (this.#debug) {
      this.#logDebug('Cache cleared');
    }
  };

  // 检查是否正在加载
  isLoaded = () => this.#loaded;

  // 获取可用语言列表
  getAvailableLanguages = () => [...this.#availableLanguages];

  // 检查语言是否可用
  isLanguageAvailable = (lang) => this.#availableLanguages.has(lang);

  // 获取当前语言
  getCurrentLanguage = () => this.#currentLang;

  // 获取默认语言
  getDefaultLanguage = () => this.#defaultLang;

  // 日期格式化 - 使用 GoDateFormatter
  formatDate = (date, customFormat) => {
    customFormat ??= this.#config.dateFormat // 2006-01-02
    return GoDateFormatter.format(date, customFormat);
  }

  // 数字格式化
  formatNumber = (number, options = {}) => {
    return new Intl.NumberFormat(this.#currentLang, options).format(number);
  };

  // 货币格式化
  formatCurrency = (amount, currency = 'USD') => {
    return this.formatNumber(amount, { style: 'currency', currency });
  };

  // 百分比格式化
  formatPercent = (value, decimals = 0) => {
    return this.formatNumber(value, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };
}

// 创建单例并注入到全局
window.i18n = new I18N();