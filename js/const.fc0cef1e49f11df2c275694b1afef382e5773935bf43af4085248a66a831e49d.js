window.CONSTANT = {
  CUSTOM_EVENT: {
    DATA_THEME_UPDATE: "dom:dataThemeUpdate",
    COLOR_THEME_UPDATE: "dom:colorThemeUpdate"
  },
  FAVICON: {
    SVG: "/favicon.svg"
  },
  SEARCH: {
    // 性能配置
    PERFORMANCE: {
      INDEX_CHUNK_SIZE: 50,
      TOKEN_CHUNK_SIZE: 20,
      MAX_FRAME_TIME: 10,
      SEARCH_DEBOUNCE: 200,
      SUGGESTION_DEBOUNCE: 100,
      MAX_TOKENS_PER_DOC: 1000,
      MIN_TOKEN_LENGTH: 2,
      MAX_TOKEN_LENGTH: 20,
      CACHE_VERSION: '2.1.0',
      USE_WEB_WORKERS: false,
      USE_REQUEST_IDLE: true
    },
    // 缓存配置
    CACHE: {
      DB_NAME: 'HugoSearchDB',
      STORE_NAME: 'searchIndex',
      EXPIRY: 24 * 60 * 60 * 1000, // 24小时
      KEYS: {
        SEARCH_INDEX: 'search_index',
        SEARCH_HISTORY: 'search_history'
      }
    },
    // 分页配置
    PAGINATION: {
      PAGE_SIZE: 10,
      MAX_VISIBLE_PAGES: 10,
      ELLIPSIS_STEP: 5
    },
    // 搜索历史配置
    HISTORY: {
      MAX_ITEMS: 10
    },
    // 任务ID
    TASK_IDS: {
      PROGRESS_UPDATE: 'progress-update',
      PROGRESS_HIDE: 'progress-hide',
      INDEX_BUILD: 'index-build',
      SEARCH_HISTORY_SAVE: 'search-history-save',
      INDEX_SAVE: 'index-save',
      SEARCH_EXECUTE: 'search-execute',
      RESULTS_RENDER: 'results-render',
      SUGGESTIONS_SHOW: 'suggestions-show',
      CATEGORY_UPDATE: 'category-update',
      DEBOUNCED_SEARCH: 'debounced-search',
      DEBOUNCED_SUGGESTIONS: 'debounced-suggestions',
      PAGINATION_UPDATE: 'pagination-update'
    }
  }
};