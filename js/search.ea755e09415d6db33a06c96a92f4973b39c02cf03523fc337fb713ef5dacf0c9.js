/**
 * Hugo 静态网站搜索功能
 */
(function hugoSearch() {
    'use strict';

    // ========================
    // 国际化配置
    // ========================
    const i18n = window.i18n;
    const BUILD_HASH = window.BUILD_HASH;

    // ========================
    // 性能优化配置
    // ========================
    const PERFORMANCE_CONFIG = {
        INDEX_CHUNK_SIZE: 50,        // 索引批处理大小
        TOKEN_CHUNK_SIZE: 20,        // 分词批处理大小
        MAX_FRAME_TIME: 10,          // 每帧最大处理时间(ms)
        SEARCH_DEBOUNCE: 200,        // 搜索防抖时间
        SUGGESTION_DEBOUNCE: 100,    // 建议防抖时间
        MAX_TOKENS_PER_DOC: 1000,    // 增加每个文档最大词条数
        MIN_TOKEN_LENGTH: 2,         // 最小词条长度
        MAX_TOKEN_LENGTH: 20,        // 最大词条长度
        CACHE_VERSION: '2.1.0',      // 更新缓存版本
        USE_WEB_WORKERS: false,      // 是否使用Web Workers（预留）
        USE_REQUEST_IDLE: true       // 使用requestIdleCallback
    };

    // ========================
    // 全局变量与配置
    // ========================
    const PriorityScheduler = window.PriorityScheduler;

    // DOM 元素引用 - 缓存所有DOM查询
    const DOM = {
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        clearButton: document.getElementById('clear-button'),
        searchStatus: document.getElementById('search-status'),
        searchResults: document.getElementById('search-results'),
        searchSuggestions: document.getElementById('search-suggestions'),
        paginationContainer: document.getElementById('pagination-container'),
        progressContainer: document.getElementById('progress-container'),
        progressFill: document.getElementById('progress-fill'),
        progressText: document.getElementById('progress-text'),
        categoryFilter: document.getElementById('category-filter'),
        dateFilterFrom: document.getElementById('date-filter-from'),
        dateFilterTo: document.getElementById('date-filter-to'),
        sortBySelect: document.getElementById('sort-by'),
        // 模板引用
        templates: {
            searchResult: document.getElementById('search-result-template'),
            suggestionItem: document.getElementById('suggestion-item-template'),
            categoryOption: document.getElementById('category-option-template'),
            paginationSimple: document.getElementById('pagination-simple-template'),
            paginationFull: document.getElementById('pagination-full-template'),
            paginationPage: document.getElementById('pagination-page-template'),
            paginationEllipsis: document.getElementById('pagination-ellipsis-template'),
            paginationDisabled: document.getElementById('pagination-disabled-template')
        }
    };

    // 搜索数据存储
    let pages = [];
    let searchIndex = null;
    let currentQueryTokens = []; // 全局存储当前查询tokens

    // 使用 Map 替代对象以提升性能
    class SearchIndex {
        constructor() {
            this.tokens = new Map();
            this.documents = new Map();
            this.categories = new Set();
            this.version = PERFORMANCE_CONFIG.CACHE_VERSION;
            this.tokenCache = new Map(); // 分词缓存
            this._sortedTokensCache = null; // 排序tokens缓存
            this._sortedTokensDirty = true; // 标记是否需要重新排序
        }

        addToken(token, docId, count) {
            if (!this.tokens.has(token)) {
                this.tokens.set(token, new Map());
            }
            this.tokens.get(token).set(docId, count);
            this._sortedTokensDirty = true; // 标记需要重新排序
        }

        getTokenDocs(token) {
            return this.tokens.get(token) || new Map();
        }

        addDocument(docId, doc) {
            this.documents.set(docId, doc);
        }

        getDocument(docId) {
            return this.documents.get(docId);
        }

        getSortedTokens() {
            if (this._sortedTokensDirty || !this._sortedTokensCache) {
                this._sortedTokensCache = Array.from(this.tokens.keys()).sort();
                this._sortedTokensDirty = false;
            }
            return this._sortedTokensCache;
        }

        // 序列化为普通对象用于存储
        toJSON() {
            return {
                tokens: Object.fromEntries(
                    Array.from(this.tokens.entries()).map(([token, docs]) =>
                        [token, Object.fromEntries(docs)]
                    )
                ),
                documents: Object.fromEntries(this.documents),
                categories: Array.from(this.categories),
                version: this.version
            };
        }

        // 从普通对象恢复
        static fromJSON(data) {
            const index = new SearchIndex();
            index.version = data.version;
            index.categories = new Set(data.categories);

            // 恢复documents
            Object.entries(data.documents).forEach(([docId, doc]) => {
                index.documents.set(docId, doc);
            });

            // 恢复tokens
            Object.entries(data.tokens).forEach(([token, docs]) => {
                const docMap = new Map(Object.entries(docs));
                index.tokens.set(token, docMap);
            });

            return index;
        }
    }

    searchIndex = new SearchIndex();

    // 分页配置
    const pageSize = 1;
    let currentPage = 1;
    let totalPages = 1;
    let allResults = [];

    // 缓存配置
    const CACHE_KEY = 'search_index';
    const CACHE_HASH_KEY = 'search_hash';
    const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

    // 搜索历史配置
    const MAX_SEARCH_HISTORY = 10;
    let searchHistory = [];

    // 搜索状态标志
    let isIndexBuilding = false;
    let isSearching = false;

    // 搜索建议相关状态
    let currentSuggestionIndex = -1;
    let currentSuggestions = [];

    // 任务ID常量
    const TASK_IDS = {
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
    };

    // ========================
    // 工具函数
    // ========================

    /**
     * 高性能防抖函数
     */
    const debounce = (taskId, func, wait, priority = PriorityScheduler.Priority.NORMAL) => {
        let lastArgs = null;
        return function (...args) {
            lastArgs = args;
            PriorityScheduler.cancel(taskId);
            PriorityScheduler.schedule(taskId, () => {
                func.apply(this, lastArgs);
                lastArgs = null;
            }, { delay: wait, priority });
        };
    };

    /**
     * 转义正则表达式特殊字符
     */
    const escapeRegExp = (() => {
        const reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
        const reHasRegExpChar = RegExp(reRegExpChar.source);

        return (string) => {
            return (string && reHasRegExpChar.test(string))
                ? string.replace(reRegExpChar, '\\$&')
                : string;
        };
    })();

    /**
     * 检查文本是否包含中文字符
     */
    const containsChinese = (text) => {
        return /[\u4e00-\u9fa5]/.test(text);
    };

    /**
     * 解析日期字符串 - 带缓存
     */
    const parseDate = (() => {
        const cache = new Map();
        return (dateStr) => {
            if (!dateStr) return null;
            if (cache.has(dateStr)) return cache.get(dateStr);
            const date = new Date(dateStr);
            cache.set(dateStr, date);
            return date;
        };
    })();

    /**
     * 解码HTML实体 - 复用textarea元素
     */
    const decodeHTMLEntities = (() => {
        let textArea = null;
        return (text) => {
            if (!text) return '';
            if (!textArea) {
                textArea = document.createElement('textarea');
            }
            textArea.innerHTML = text;
            return textArea.value;
        };
    })();

    /**
     * 显示进度条
     */
    const showProgress = (percent, text) => {
        DOM.progressContainer.classList.add('expanded');
        console.log(i18n.t('search.console.currentPercent', { percent }));
        DOM.progressFill.style.width = `${percent}%`;
        DOM.progressText.textContent = text || i18n.t('search.progress.processing', { percent: Math.round(percent) });
    };

    /**
     * 隐藏进度条
    */
    const hideProgress = () => {
        PriorityScheduler.schedule(TASK_IDS.PROGRESS_HIDE, () => {
            DOM.progressContainer.classList.remove('expanded');
        }, { delay: 500, priority: PriorityScheduler.Priority.LOW });
    };

    /**
     * 添加搜索历史记录
     */
    const addToSearchHistory = (term) => {
        if (!term || term.trim() === '') return;

        // 使用Set优化去重
        const historySet = new Set(searchHistory);
        historySet.delete(term);
        searchHistory = [term, ...Array.from(historySet)].slice(0, MAX_SEARCH_HISTORY);

        PriorityScheduler.schedule(TASK_IDS.SEARCH_HISTORY_SAVE, () => {
            try {
                localStorage.setItem('hugo_search_history', JSON.stringify(searchHistory));
            } catch (e) {
                console.warn(i18n.t('search.errors.saveHistoryFailed'), e);
            }
        }, { priority: PriorityScheduler.Priority.IDLE });
    };

    /**
     * 加载搜索历史记录
     */
    const loadSearchHistory = () => {
        try {
            const saved = localStorage.getItem('hugo_search_history');
            if (saved) {
                searchHistory = JSON.parse(saved);
            }
        } catch (e) {
            console.warn(i18n.t('search.errors.loadHistoryFailed'), e);
            searchHistory = [];
        }
    };

    /**
     * 更新分类选项下拉菜单 - 使用模板
     */
    const updateCategoryOptions = () => {
        const fragment = document.createDocumentFragment();
        const sortedCategories = Array.from(searchIndex.categories).sort();

        // 保留第一个选项
        while (DOM.categoryFilter.options.length > 1) {
            DOM.categoryFilter.remove(1);
        }

        sortedCategories.forEach(category => {
            const option = DOM.templates.categoryOption.content.cloneNode(true);
            const optionElement = option.querySelector('option');
            optionElement.value = category;
            optionElement.textContent = category;
            fragment.appendChild(option);
        });

        DOM.categoryFilter.appendChild(fragment);
    };

    // ========================
    // 缓存管理
    // ========================

    /**
     * 保存索引到本地存储
     */
    const saveIndexToLocalStorage = () => {
        PriorityScheduler.schedule(TASK_IDS.INDEX_SAVE, () => {
            try {
                const cacheData = {
                    timestamp: Date.now(),
                    ...searchIndex.toJSON()
                };

                const dataStr = JSON.stringify(cacheData);
                if (dataStr.length > 5 * 1024 * 1024) {
                    console.warn(i18n.t('search.errors.indexTooLarge'));
                    return;
                }

                localStorage.setItem(CACHE_KEY, dataStr);
                console.log(i18n.t('search.console.indexSaved'));
                localStorage.setItem(CACHE_HASH_KEY, BUILD_HASH);

            } catch (error) {
                console.error(i18n.t('search.errors.saveIndexFailed'), error);
            }
        }, { priority: PriorityScheduler.Priority.IDLE });
    };

    /**
     * 从本地存储加载索引
     */
    const loadIndexFromLocalStorage = () => {
        try {
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (!cachedData) return null;

            const data = JSON.parse(cachedData);
            const now = Date.now();

            if (now - data.timestamp > CACHE_EXPIRY || data.version !== PERFORMANCE_CONFIG.CACHE_VERSION) {
                console.log(i18n.t('search.console.cacheExpired'));
                clearIndexFromLocalStorage();
                return null;
            }

            return SearchIndex.fromJSON(data);
        } catch (error) {
            console.error(i18n.t('search.errors.loadIndexFailed'), error);
            clearIndexFromLocalStorage();
            return null;
        }
    };

    const isSearchIndexValid = () => {
        try {
            const prevBuildHash = localStorage.getItem(CACHE_HASH_KEY);
            const valid = prevBuildHash === BUILD_HASH
            console.debug("prevBuildHash", prevBuildHash, "buildHash", BUILD_HASH, "valid", valid);
            if (!valid) localStorage.removeItem(CACHE_HASH_KEY);
            return valid;
        } catch {
            return false;
        }
    }

    /**
     * 清除本地存储中的索引数据
     */
    const clearIndexFromLocalStorage = () => {
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_HASH_KEY);
        } catch (error) {
            console.warn(i18n.t('search.errors.clearCacheFailed'), error);
        }
    };

    // ========================
    // 分词与索引
    // ========================

    // 停用词列表
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
        'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'as', 'of',
        '的', '了', '和', '是', '在', '有', '与', '这', '那', '都', '中'
    ]);

    /**
     * 基础分词函数（适用于英文）- 优化版
     */
    const tokenizeBasic = (() => {
        const wordRegex = /\p{L}+/gu;

        return (text) => {
            if (!text) return [];
            const matches = text.toLowerCase().match(wordRegex) || [];
            return matches.filter(token =>
                token.length >= PERFORMANCE_CONFIG.MIN_TOKEN_LENGTH &&
                token.length <= PERFORMANCE_CONFIG.MAX_TOKEN_LENGTH &&
                !stopWords.has(token)
            );
        };
    })();

    /**
     * 中文分词函数（使用n-gram方法）- 优化版
     */
    const tokenizeChinese = (text) => {
        if (!text) return [];
        const tokens = new Set();
        const normalized = text.toLowerCase();
        const chineseRegex = /[\u4e00-\u9fa5]+/g;
        let match;

        while ((match = chineseRegex.exec(normalized)) !== null) {
            const chars = match[0];
            // 单字
            for (let i = 0; i < chars.length; i++) {
                tokens.add(chars[i]);
            }
            // 2-3字的词组
            for (let n = 2; n <= 3 && n <= chars.length; n++) {
                for (let i = 0; i <= chars.length - n; i++) {
                    tokens.add(chars.substring(i, i + n));
                }
            }
        }

        return Array.from(tokens);
    };

    /**
     * 综合分词函数 - 带缓存（修复：为每个文档生成独立的tokens）
     */
    const tokenize = (text, useCache = true) => {
        if (!text) return [];

        // 注意：缓存应该谨慎使用，避免不同文档共享相同的tokens
        if (useCache && searchIndex.tokenCache.has(text)) {
            return [...searchIndex.tokenCache.get(text)]; // 返回副本
        }

        const baseTokens = tokenizeBasic(text);
        const chineseTokens = containsChinese(text) ? tokenizeChinese(text) : [];
        const allTokens = [...new Set([...baseTokens, ...chineseTokens])];

        // 限制token数量
        const result = allTokens.slice(0, PERFORMANCE_CONFIG.MAX_TOKENS_PER_DOC);

        // 存入缓存（限制缓存大小）
        if (useCache && searchIndex.tokenCache.size < 500) {
            searchIndex.tokenCache.set(text, result);
        }

        return result;
    };

    /**
     * 优化的词频计算函数
     */
    const countTokenOccurrences = (text, token) => {
        if (!text || !token) return 0;
        const lowerText = text.toLowerCase();
        const lowerToken = token.toLowerCase();
        const tokenLen = lowerToken.length;
        let count = 0;
        let pos = 0;

        while ((pos = lowerText.indexOf(lowerToken, pos)) !== -1) {
            count++;
            pos += tokenLen;
        }

        return count;
    };

    /**
     * 构建搜索索引
     */
    const buildSearchIndex = () => {
        return new Promise((resolve) => {
            isIndexBuilding = true;
            searchIndex = new SearchIndex();

            showProgress(0, i18n.t('search.progress.preparing'));

            const totalPages = pages.length;
            let currentIndex = 0;
            const startTime = performance.now();

            const processNextBatch = () => {
                const batchStartTime = performance.now();
                let processed = 0;

                // 修复：移除额外的break语句，确保在时间允许的情况下持续处理
                while (currentIndex < totalPages &&
                    performance.now() - batchStartTime < PERFORMANCE_CONFIG.MAX_FRAME_TIME) {

                    const page = pages[currentIndex];
                    const docId = 'doc_' + currentIndex;

                    // 添加文档
                    searchIndex.addDocument(docId, page);

                    // 添加分类
                    if (page.section) {
                        searchIndex.categories.add(page.section);
                    }

                    // 构建全文索引
                    const allText = `${page.title || ''} ${page.content || ''} ${page.summary || ''}`;
                    // 不使用缓存，确保每个文档的tokens是独立的
                    const tokens = tokenize(allText, false);

                    // 使用Map批量处理token计数
                    const tokenCounts = new Map();
                    tokens.forEach(token => {
                        if (!tokenCounts.has(token)) {
                            const count = countTokenOccurrences(allText, token);
                            if (count > 0) {
                                tokenCounts.set(token, count);
                            }
                        }
                    });

                    // 批量添加到索引
                    tokenCounts.forEach((count, token) => {
                        searchIndex.addToken(token, docId, count);
                    });

                    currentIndex++;
                    processed++;
                }

                const percentComplete = Math.round((currentIndex / totalPages) * 90);
                showProgress(percentComplete, i18n.t('search.progress.building', {
                    current: currentIndex,
                    total: totalPages
                }));

                if (currentIndex < totalPages) {
                    // 使用requestIdleCallback处理剩余任务
                    if ('requestIdleCallback' in window && PERFORMANCE_CONFIG.USE_REQUEST_IDLE) {
                        requestIdleCallback(processNextBatch, { timeout: 50 });
                    } else {
                        requestAnimationFrame(processNextBatch);
                    }
                } else {
                    // 完成索引构建
                    const buildTime = Math.round(performance.now() - startTime);
                    showProgress(95, i18n.t('search.progress.optimizing'));

                    PriorityScheduler.schedule('index-complete', () => {
                        optimizeIndex();
                        updateCategoryOptions();
                        saveIndexToLocalStorage();
                        showProgress(100, i18n.t('search.progress.completed', { time: buildTime }));
                        console.log(i18n.t('search.console.indexCompleted', {
                            tokens: searchIndex.tokens.size,
                            documents: searchIndex.documents.size,
                            time: buildTime
                        }));
                        hideProgress();
                        isIndexBuilding = false;
                        resolve(searchIndex);
                    }, { delay: 100 });
                }
            };

            // 开始处理
            if ('requestIdleCallback' in window && PERFORMANCE_CONFIG.USE_REQUEST_IDLE) {
                requestIdleCallback(processNextBatch, { timeout: 50 });
            } else {
                requestAnimationFrame(processNextBatch);
            }
        });
    };

    /**
     * 优化索引 - 修复：降低删除阈值
     */
    const optimizeIndex = () => {
        const documentCount = searchIndex.documents.size;
        if (documentCount <= 10) return; // 文档太少时不优化

        // 修复：只删除出现在95%以上文档中的词（原来是80%）
        const threshold = documentCount * 0.95;
        const tokensToRemove = [];

        searchIndex.tokens.forEach((docs, token) => {
            if (docs.size > threshold && stopWords.has(token)) {
                // 只删除停用词中的高频词
                tokensToRemove.push(token);
            }
        });

        tokensToRemove.forEach(token => {
            searchIndex.tokens.delete(token);
        });

        if (tokensToRemove.length > 0) {
            console.log(i18n.t('search.console.optimizedIndex', { count: tokensToRemove.length }));
        }
    };

    // ========================
    // 搜索功能
    // ========================

    /**
     * 查找匹配的词条 - 修复版
     */
    const findMatchingTokens = (prefix) => {
        if (!prefix || prefix.length < 2) return [];

        const sortedTokens = searchIndex.getSortedTokens();
        const lowerPrefix = prefix.toLowerCase();
        const results = [];

        // 二分查找起始位置
        let left = 0;
        let right = sortedTokens.length - 1;
        let startIndex = -1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (sortedTokens[mid].startsWith(lowerPrefix)) {
                startIndex = mid;
                right = mid - 1;
            } else if (sortedTokens[mid] < lowerPrefix) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        if (startIndex !== -1) {
            // 收集所有匹配的tokens
            for (let i = startIndex; i < sortedTokens.length && sortedTokens[i].startsWith(lowerPrefix); i++) {
                results.push(sortedTokens[i]);
                if (results.length >= 20) break; // 增加结果数量限制
            }
        }

        return results;
    };

    /**
     * 使用索引进行搜索 - 修复版
     */
    const searchWithIndex = (query, filters = {}) => {
        if (!query.trim()) return [];

        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        // 存储查询tokens供其他函数使用
        currentQueryTokens = queryTokens;

        // 查找匹配的tokens
        let allMatchingTokens = new Set(queryTokens);

        // 对查询中的每个token查找前缀匹配
        queryTokens.forEach(queryToken => {
            if (queryToken.length >= 2) {
                const prefixMatches = findMatchingTokens(queryToken);
                prefixMatches.forEach(token => allMatchingTokens.add(token));
            }
        });

        if (allMatchingTokens.size === 0) return [];

        // 使用Map存储文档得分
        const documentScores = new Map();
        const documentTokens = new Map();

        // 计算文档得分
        allMatchingTokens.forEach(token => {
            const docsWithToken = searchIndex.getTokenDocs(token);
            docsWithToken.forEach((frequency, docId) => {
                if (!documentTokens.has(docId)) {
                    documentTokens.set(docId, new Set());
                }
                documentTokens.get(docId).add(token);

                const currentScore = documentScores.get(docId) || 0;

                // 调整评分算法
                let tokenScore = frequency;

                // 精确匹配加分
                if (queryTokens.includes(token)) {
                    tokenScore *= 2.0;
                }

                // 标题匹配额外加分
                const doc = searchIndex.getDocument(docId);
                if (doc && doc.title && doc.title.toLowerCase().includes(token)) {
                    tokenScore *= 1.5;
                }

                // 前缀匹配评分
                const matchesQueryPrefix = queryTokens.some(qt => token.startsWith(qt.toLowerCase()));
                if (matchesQueryPrefix && !queryTokens.includes(token)) {
                    tokenScore *= 0.8;
                }

                documentScores.set(docId, currentScore + tokenScore);
            });
        });

        // 转换为结果数组
        let results = Array.from(documentScores.entries())
            .filter(([_, score]) => score > 0) // 确保有有效得分
            .map(([docId, score]) => ({
                document: searchIndex.getDocument(docId),
                score: Math.round(score * 100) / 100,
                matchedTokens: Array.from(documentTokens.get(docId))
            }));

        // 应用过滤和排序
        results = applySorting(applyFilters(results, filters), filters.sortBy || 'relevance');

        return results;
    };

    /**
     * 应用过滤条件
     */
    const applyFilters = (results, filters) => {
        if (!filters.category && !filters.dateFrom && !filters.dateTo) {
            return results;
        }

        return results.filter(result => {
            const doc = result.document;

            if (filters.category && doc.section !== filters.category) return false;

            if (filters.dateFrom || filters.dateTo) {
                const docDate = parseDate(doc.date);
                if (!docDate) return false;

                if (filters.dateFrom) {
                    const fromDate = parseDate(filters.dateFrom);
                    if (docDate < fromDate) return false;
                }

                if (filters.dateTo) {
                    const toDate = parseDate(filters.dateTo);
                    toDate.setHours(23, 59, 59, 999);
                    if (docDate > toDate) return false;
                }
            }

            return true;
        });
    };

    /**
     * 应用排序规则
     */
    const applySorting = (results, sortBy) => {
        switch (sortBy) {
            case 'date-desc':
                return results.sort((a, b) => {
                    const dateA = parseDate(a.document.date) || new Date(0);
                    const dateB = parseDate(b.document.date) || new Date(0);
                    return dateB - dateA;
                });
            case 'date-asc':
                return results.sort((a, b) => {
                    const dateA = parseDate(a.document.date) || new Date(0);
                    const dateB = parseDate(b.document.date) || new Date(0);
                    return dateA - dateB;
                });
            case 'relevance':
            default:
                return results.sort((a, b) => b.score - a.score);
        }
    };

    // ========================
    // 搜索结果显示
    // ========================

    /**
     * 高亮显示匹配的文本 - 优化版
     */
    const highlightText = (() => {
        // 缓存正则表达式
        const regexCache = new Map();

        return (text, tokens) => {
            if (!text || !tokens || tokens.length === 0) {
                return document.createTextNode(text || '');
            }

            const validTokens = tokens.filter(token => token && token.length > 1);
            if (validTokens.length === 0) {
                return document.createTextNode(text);
            }

            // 创建合并的正则表达式
            const cacheKey = validTokens.join('|');
            let regex = regexCache.get(cacheKey);

            if (!regex) {
                const pattern = validTokens
                    .sort((a, b) => b.length - a.length)
                    .map(token => escapeRegExp(token))
                    .join('|');
                regex = new RegExp(`(${pattern})`, 'gi');
                if (regexCache.size < 100) { // 限制缓存大小
                    regexCache.set(cacheKey, regex);
                }
            }

            // 使用DocumentFragment提升性能
            const fragment = document.createDocumentFragment();
            const parts = text.split(regex);

            parts.forEach((part, index) => {
                if (index % 2 === 0) {
                    // 非匹配部分
                    if (part) {
                        fragment.appendChild(document.createTextNode(part));
                    }
                } else {
                    // 匹配部分
                    const mark = document.createElement('mark');
                    mark.className = 'bg-yellow-200 px-0.5 rounded';
                    mark.textContent = part;
                    fragment.appendChild(mark);
                }
            });

            return fragment;
        };
    })();

    /**
     * 查找相关上下文 - 修复版
     */
    const findRelevantContext = (page, tokens, queryTokens) => {
        if (!page.content) return page.summary || '';

        const content = page.content;
        const lowerContent = content.toLowerCase();
        let bestStart = 0;
        let bestScore = 0;

        // 优先查找查询词的位置
        const searchTokens = queryTokens || tokens;

        searchTokens.forEach(token => {
            const lowerToken = token.toLowerCase();
            const index = lowerContent.indexOf(lowerToken);
            if (index !== -1) {
                // 查询词权重更高
                const isQueryToken = queryTokens && queryTokens.includes(token);
                const score = token.length * (isQueryToken ? 3 : 1);
                if (score > bestScore) {
                    bestScore = score;
                    bestStart = Math.max(0, index - 50);
                }
            }
        });

        // 如果没找到匹配，返回摘要或内容开头
        if (bestScore === 0) {
            return page.summary || content.substring(0, 150) + '...';
        }

        // 提取上下文
        const contextLength = 200; // 增加上下文长度
        let context = content.substring(bestStart, bestStart + contextLength);

        if (bestStart > 0) context = '...' + context;
        if (bestStart + contextLength < content.length) context += '...';

        return context;
    };

    /**
     * 执行搜索 - 修复版
     */
    const performSearch = (term, resetPage = true) => {
        if (isSearching || isIndexBuilding) return;

        isSearching = true;

        if (resetPage) {
            currentPage = 1;
        }

        if (!term.trim()) {
            DOM.searchStatus.textContent = '';
            DOM.searchResults.innerHTML = '';
            DOM.paginationContainer.classList.add('hidden');
            isSearching = false;
            return;
        }

        const filters = {
            category: DOM.categoryFilter.value,
            dateFrom: DOM.dateFilterFrom.value,
            dateTo: DOM.dateFilterTo.value,
            sortBy: DOM.sortBySelect.value
        };

        DOM.searchStatus.textContent = i18n.t('search.status.searching');

        // 异步执行搜索
        PriorityScheduler.schedule(TASK_IDS.SEARCH_EXECUTE, () => {
            const startTime = performance.now();
            allResults = searchWithIndex(term, filters);
            const searchTime = Math.round(performance.now() - startTime);

            addToSearchHistory(term);

            DOM.searchStatus.textContent = i18n.t('search.status.results', {
                count: allResults.length,
                time: searchTime
            });

            if (allResults.length === 0) {
                DOM.searchResults.innerHTML = `<div class="text-center py-8 text-gray-500">${i18n.t('search.status.noResults')}</div>`;
                DOM.paginationContainer.classList.add('hidden');
                isSearching = false;
                return;
            }

            totalPages = Math.ceil(allResults.length / pageSize);
            loadResults();
            updatePagination();
        }, { priority: PriorityScheduler.Priority.HIGH });
    };

    /**
     * 加载搜索结果 - 使用模板
     */
    const loadResults = () => {
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const currentResults = allResults.slice(startIndex, endIndex);

        // 清空结果容器
        DOM.searchResults.innerHTML = '';

        // 使用DocumentFragment批量插入
        const fragment = document.createDocumentFragment();

        currentResults.forEach(result => {
            const resultClone = DOM.templates.searchResult.content.cloneNode(true);
            const article = resultClone.querySelector('.search-result');

            const page = result.document;
            const context = findRelevantContext(page, result.matchedTokens, currentQueryTokens);

            // 设置链接
            const linkElement = article.querySelector('.search-result-link');
            linkElement.href = page.url;

            // 设置标题（使用高亮）
            const titleElement = article.querySelector('.search-result-title');
            titleElement.innerHTML = '';
            titleElement.appendChild(highlightText(page.title, currentQueryTokens));

            // 设置相关度分数
            const scoreElement = article.querySelector('.search-result-score');
            scoreElement.textContent = i18n.t('search.result.relevance', { score: result.score });

            // 设置日期
            const dateElement = article.querySelector('.search-result-date');
            dateElement.textContent = i18n.formatDate(page.date);

            // 设置分类
            const sectionElement = article.querySelector('.search-result-section');
            if (page.section) {
                sectionElement.textContent = page.section;
                sectionElement.classList.remove('hidden');
            }

            // 设置URL
            const urlElement = article.querySelector('.search-result-url');
            urlElement.href = page.url;
            urlElement.textContent = page.url;

            // 设置内容（使用高亮）
            const contentElement = article.querySelector('.search-result-content');
            const highlightTokens = [...new Set([...currentQueryTokens, ...result.matchedTokens])];
            contentElement.innerHTML = '';
            contentElement.appendChild(highlightText(context, highlightTokens));

            fragment.appendChild(resultClone);
        });

        DOM.searchResults.appendChild(fragment);
        isSearching = false;
    };

    /**
     * 更新分页器 - 使用与 pagination.html 相同的结构
     */
    const updatePagination = () => {
        if (allResults.length === 0) {
            DOM.paginationContainer.classList.add('hidden');
            return;
        }

        DOM.paginationContainer.classList.remove('hidden');
        DOM.paginationContainer.innerHTML = '';

        // 简化视图（总页数 <= 3）
        if (totalPages <= 3) {
            renderSimplePagination();
        } else {
            renderFullPagination();
        }
    };

    /**
     * 渲染简化分页视图
     */
    const renderSimplePagination = () => {
        const template = DOM.templates.paginationSimple.content.cloneNode(true);
        const prevBtn = template.querySelector('.pagination-prev');
        const nextBtn = template.querySelector('.pagination-next');

        // 设置上一页按钮
        if (currentPage > 1) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(currentPage - 1);
            });
        } else {
            // 替换为禁用的占位符
            const disabled = DOM.templates.paginationDisabled.content.cloneNode(true);
            const span = disabled.querySelector('span');
            span.className = 'ui-button-concealed ui-interactive disabled col-span-1';
            prevBtn.replaceWith(span);
        }

        // 设置下一页按钮
        if (currentPage < totalPages) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(currentPage + 1);
            });
        } else {
            // 替换为禁用的占位符
            const disabled = DOM.templates.paginationDisabled.content.cloneNode(true);
            const span = disabled.querySelector('span');
            span.className = 'ui-button-concealed ui-interactive disabled col-span-1';
            nextBtn.replaceWith(span);
        }

        DOM.paginationContainer.appendChild(template);
    };

    /**
     * 渲染完整分页视图
     */
    const renderFullPagination = () => {
        const template = DOM.templates.paginationFull.content.cloneNode(true);
        const prevBtn = template.querySelector('.pagination-prev');
        const nextBtn = template.querySelector('.pagination-next');
        const numbersContainer = template.querySelector('.pagination-numbers');

        // 设置上一页按钮
        if (currentPage > 1) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(currentPage - 1);
            });
        } else {
            // 替换为禁用的占位符
            const disabled = DOM.templates.paginationDisabled.content.cloneNode(true);
            const span = disabled.querySelector('span');
            span.className = 'ui-button-concealed ui-interactive disabled col-span-2';
            prevBtn.replaceWith(span);
        }

        // 设置下一页按钮
        if (currentPage < totalPages) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(currentPage + 1);
            });
        } else {
            // 替换为禁用的占位符
            const disabled = DOM.templates.paginationDisabled.content.cloneNode(true);
            const span = disabled.querySelector('span');
            span.className = 'ui-button-concealed ui-interactive disabled col-span-2';
            nextBtn.replaceWith(span);
        }

        // 生成页码按钮
        const fragment = generatePageNumbers();
        numbersContainer.appendChild(fragment);

        DOM.paginationContainer.appendChild(template);
    };

    /**
     * 生成页码按钮（遵循 pagination.html 的逻辑）
     */
    const generatePageNumbers = () => {
        const fragment = document.createDocumentFragment();
        const maxVisible = 10; // 可配置
        const ellipsisStep = 5;

        // 计算显示范围
        const showLeftEllipsis = currentPage > 2;
        const showRightEllipsis = currentPage < totalPages - 1;
        let visibleSlots = maxVisible - 2; // 减去首尾页
        if (showLeftEllipsis) visibleSlots--;
        if (showRightEllipsis) visibleSlots--;

        let start = Math.max(2, currentPage - Math.floor(visibleSlots / 2));
        let end = Math.min(totalPages - 1, start + visibleSlots - 1);

        if (end === totalPages - 1) {
            start = Math.max(2, end - visibleSlots + 1);
        }

        // 第一页
        fragment.appendChild(createPageButton(1, currentPage === 1));

        // 左侧省略号
        if (showLeftEllipsis && start > 2) {
            const target = Math.max(1, currentPage - ellipsisStep);
            fragment.appendChild(createEllipsisButton(target, 'left', i18n.t('search.pagination.prevPages', { count: ellipsisStep })));
        }

        // 中间页码
        for (let i = start; i <= end; i++) {
            fragment.appendChild(createPageButton(i, currentPage === i));
        }

        // 右侧省略号
        if (showRightEllipsis && end < totalPages - 1) {
            const target = Math.min(totalPages, currentPage + ellipsisStep);
            fragment.appendChild(createEllipsisButton(target, 'right', i18n.t('search.pagination.nextPages', { count: ellipsisStep })));
        }

        // 最后一页
        if (totalPages > 1) {
            fragment.appendChild(createPageButton(totalPages, currentPage === totalPages));
        }

        return fragment;
    };

    /**
     * 创建页码按钮
     */
    const createPageButton = (pageNum, isActive) => {
        const template = DOM.templates.paginationPage.content.cloneNode(true);
        const button = template.querySelector('a');

        button.textContent = pageNum;

        if (isActive) {
            button.classList.add('selected');
            button.style.pointerEvents = 'none';
        } else {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(pageNum);
            });
        }

        return template;
    };

    /**
     * 创建省略号按钮
     */
    const createEllipsisButton = (targetPage, direction, tooltip) => {
        const template = DOM.templates.paginationEllipsis.content.cloneNode(true);
        const container = template.querySelector('.ui-tooltip');
        const button = template.querySelector('a');
        const icon = template.querySelector('.pagination-ellipsis-icon');

        // 设置提示文本
        container.setAttribute('data-tooltip', tooltip);

        // 设置图标（需要根据你的图标系统调整）
        if (direction === 'left') {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="11 17 6 12 11 7"></polyline>
                <polyline points="18 17 13 12 18 7"></polyline>
            </svg>`;
        } else {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="13 17 18 12 13 7"></polyline>
                <polyline points="6 17 11 12 6 7"></polyline>
            </svg>`;
        }

        button.addEventListener('click', (e) => {
            e.preventDefault();
            goToPage(targetPage);
        });

        return template;
    };

    /**
     * 跳转到指定页
     */
    const goToPage = (pageNum) => {
        currentPage = pageNum;
        loadResults();
        updatePagination();

        // 平滑滚动到结果顶部
        DOM.searchResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // ========================
    // 搜索建议
    // ========================

    /**
     * 生成搜索建议 - 优化版
     */
    const generateSearchSuggestions = (() => {
        const cache = new Map();

        return (term) => {
            if (!term || term.length < 2) return [];

            // 检查缓存
            if (cache.has(term)) {
                return cache.get(term);
            }

            // 从历史记录查找
            const historyMatches = searchHistory
                .filter(item => item.toLowerCase().includes(term.toLowerCase()))
                .slice(0, 3);

            // 从索引查找
            const tokenMatches = [];
            if (searchIndex.tokens.size > 0) {
                const matchingTokens = findMatchingTokens(term.toLowerCase());
                tokenMatches.push(...matchingTokens.slice(0, 5));
            }

            const results = [...new Set([...historyMatches, ...tokenMatches])].slice(0, 8);

            // 缓存结果
            if (cache.size < 50) { // 限制缓存大小
                cache.set(term, results);
            }

            return results;
        };
    })();

    /**
     * 显示搜索建议 - 使用模板
     */
    const showSearchSuggestions = (suggestions) => {
        currentSuggestions = suggestions || [];
        currentSuggestionIndex = -1;

        if (currentSuggestions.length === 0) {
            hideSuggestions();
            return;
        }

        // 清空现有内容
        DOM.searchSuggestions.innerHTML = '';

        // 使用 DocumentFragment 批量插入
        const fragment = document.createDocumentFragment();

        currentSuggestions.forEach((suggestion, index) => {
            const itemClone = DOM.templates.suggestionItem.content.cloneNode(true);
            const item = itemClone.querySelector('.suggestion-item');

            item.textContent = suggestion;
            item.dataset.index = index;

            item.addEventListener('click', handleSuggestionClick);
            item.addEventListener('mouseenter', () => {
                setActiveSuggestion(index);
            });

            fragment.appendChild(itemClone);
        });

        DOM.searchSuggestions.appendChild(fragment);
        DOM.searchSuggestions.classList.remove('hidden');
    };

    /**
     * 隐藏搜索建议下拉框
     */
    const hideSuggestions = () => {
        DOM.searchSuggestions.classList.add('hidden');
        DOM.searchSuggestions.innerHTML = '';
        currentSuggestions = [];
        currentSuggestionIndex = -1;
    };

    /**
     * 设置活动的建议项
     */
    const setActiveSuggestion = (index) => {
        // 移除所有 active 类
        const items = DOM.searchSuggestions.querySelectorAll('.suggestion-item');
        items.forEach(item => item.classList.remove('active'));

        // 设置新的 active 项
        if (index >= 0 && index < items.length) {
            currentSuggestionIndex = index;
            items[index].classList.add('active');
            // 确保选中项在视野内
            items[index].scrollIntoView({ block: 'nearest' });
        } else {
            currentSuggestionIndex = -1;
        }
    };

    /**
     * 选择当前建议项
     */
    const selectCurrentSuggestion = () => {
        if (currentSuggestionIndex >= 0 && currentSuggestionIndex < currentSuggestions.length) {
            DOM.searchInput.value = currentSuggestions[currentSuggestionIndex];
            hideSuggestions();
            performSearch(DOM.searchInput.value);
        }
    };

    /**
     * 处理建议点击
     */
    const handleSuggestionClick = (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        if (index >= 0 && index < currentSuggestions.length) {
            DOM.searchInput.value = currentSuggestions[index];
            hideSuggestions();
            performSearch(DOM.searchInput.value);
        }
    };

    // ========================
    // 事件监听器
    // ========================

    /**
     * 初始化搜索相关的事件监听器
     */
    const initSearchListeners = () => {
        // 优化的防抖搜索
        const debouncedSearch = debounce(
            TASK_IDS.DEBOUNCED_SEARCH,
            (term) => performSearch(term),
            PERFORMANCE_CONFIG.SEARCH_DEBOUNCE,
            PriorityScheduler.Priority.HIGH
        );

        // 优化的防抖建议
        const debouncedSuggestions = debounce(
            TASK_IDS.DEBOUNCED_SUGGESTIONS,
            (term) => {
                if (term.length >= 2) {
                    DOM.searchInput.dataset.originalValue = term; // 保存原始值
                    const suggestions = generateSearchSuggestions(term);
                    showSearchSuggestions(suggestions);
                } else {
                    hideSuggestions();
                }
            },
            PERFORMANCE_CONFIG.SUGGESTION_DEBOUNCE,
            PriorityScheduler.Priority.IMMEDIATE
        );

        // 搜索输入事件
        DOM.searchInput.addEventListener('input', function () {
            const term = this.value;
            DOM.clearButton.classList.toggle('hidden', !term);

            debouncedSuggestions(term);

            if (term.trim().length >= 2) {
                debouncedSearch(term);
            } else if (!term.trim()) {
                DOM.searchResults.innerHTML = '';
                DOM.searchStatus.textContent = '';
                DOM.paginationContainer.classList.add('hidden');
            }
        });

        // 键盘导航事件
        DOM.searchInput.addEventListener('keydown', function (e) {
            const suggestionsVisible = !DOM.searchSuggestions.classList.contains('hidden');

            switch (e.key) {
                case 'ArrowDown':
                    if (suggestionsVisible) {
                        e.preventDefault();
                        const newIndex = currentSuggestionIndex + 1;
                        if (newIndex < currentSuggestions.length) {
                            setActiveSuggestion(newIndex);
                        }
                    }
                    break;

                case 'ArrowUp':
                    if (suggestionsVisible) {
                        e.preventDefault();
                        const newIndex = currentSuggestionIndex - 1;
                        if (newIndex >= -1) {
                            setActiveSuggestion(newIndex);
                            if (newIndex === -1) {
                                // 恢复原始输入
                                DOM.searchInput.value = DOM.searchInput.dataset.originalValue || '';
                            }
                        }
                    }
                    break;

                case 'Enter':
                    e.preventDefault();
                    if (suggestionsVisible && currentSuggestionIndex >= 0) {
                        selectCurrentSuggestion();
                    } else {
                        hideSuggestions();
                        performSearch(this.value);
                    }
                    break;

                case 'Escape':
                    if (suggestionsVisible) {
                        e.preventDefault();
                        hideSuggestions();
                    }
                    break;
            }
        });

        // 保存原始输入值
        DOM.searchInput.addEventListener('focus', function () {
            this.dataset.originalValue = this.value;
        });

        // 搜索按钮
        DOM.searchButton.addEventListener('click', () => {
            hideSuggestions();
            performSearch(DOM.searchInput.value);
        });

        // 清除按钮
        DOM.clearButton.addEventListener('click', () => {
            DOM.searchInput.value = '';
            DOM.searchInput.focus();
            DOM.clearButton.classList.add('hidden');
            DOM.searchStatus.textContent = '';
            DOM.searchResults.innerHTML = '';
            DOM.paginationContainer.classList.add('hidden');
            hideSuggestions();
        });

        // 过滤器变化时重新搜索
        const filterElements = [DOM.categoryFilter, DOM.dateFilterFrom, DOM.dateFilterTo, DOM.sortBySelect];
        filterElements.forEach(filter => {
            filter.addEventListener('change', () => {
                if (DOM.searchInput.value.trim()) {
                    performSearch(DOM.searchInput.value);
                }
            });
        });

        // 点击外部关闭建议
        document.addEventListener('click', (e) => {
            if (!DOM.searchInput.contains(e.target) && !DOM.searchSuggestions.contains(e.target)) {
                hideSuggestions();
            }
        });

        // 监听窗口大小变化，重新定位建议框
        window.addEventListener('resize', debounce('resize-suggestions', hideSuggestions, 100));
    };

    // ========================
    // 数据加载与初始化
    // ========================

    /**
     * 加载页面数据并初始化搜索功能
     */
    const loadPagesData = async () => {
        showProgress(0, i18n.t('search.progress.initializing'));

        try {
            loadSearchHistory();

            showProgress(10, i18n.t('search.progress.checkingCache'));
            const cachedIndex = loadIndexFromLocalStorage();
            const searchIndexValid = isSearchIndexValid();

            let runCount = 0;
            const maxRuns = 7;

            if (cachedIndex && searchIndexValid) {
                searchIndex = cachedIndex;
                PriorityScheduler.scheduleRepeating(TASK_IDS.PROGRESS_UPDATE,
                    () => {
                        showProgress((++runCount + 1) * 10, i18n.t('search.progress.loadingCache'));
                    }, 300, {
                    maxRuns
                });

                updateCategoryOptions();
                initSearchListeners();
                DOM.searchInput.focus();

                showProgress(70, i18n.t('search.progress.cacheLoaded', {
                    tokens: searchIndex.tokens.size,
                    documents: searchIndex.documents.size
                }));
                PriorityScheduler.cancel(TASK_IDS.PROGRESS_UPDATE);
                await PriorityScheduler.delay(1000);
                showProgress(100, i18n.t('search.progress.loadCompleted'));
                hideProgress();

                return;
            }

            showProgress(20, i18n.t('search.progress.loadingData'));

            // TODO 缓存需要主动进行判断是否需要更新    
            const response = await fetch(`/search/search.json?hash=${window.BUILD_HASH}`);

            if (!response.ok) {
                throw new Error(i18n.t('search.console.httpError', { status: response.status }));
            }

            const data = await response.json();
            showProgress(50, i18n.t('search.progress.processingData'));

            // 批量处理页面数据
            pages = data.map(page => ({
                ...page,
                content: decodeHTMLEntities(page.content || ''),
                summary: decodeHTMLEntities(page.summary || ''),
                title: decodeHTMLEntities(page.title || '')
            }));

            console.log(i18n.t('search.console.pagesLoaded', { count: pages.length }));

            await buildSearchIndex();

            initSearchListeners();
            DOM.searchInput.focus();

        } catch (error) {
            console.error(i18n.t('search.errors.loadDataFailed'), error);
            DOM.searchResults.innerHTML = `<div class="text-center py-8 text-red-500">${i18n.t('search.errors.loadDataFailed')}</div>`;
            hideProgress();
        }
    };

    // ========================
    // 入口点
    // ========================

    // 使用性能优化的初始化
    PriorityScheduler.ensureDocumentReady(loadPagesData);

})();