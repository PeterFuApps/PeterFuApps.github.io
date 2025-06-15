(function (window, document, navigator) {
    'use strict';

    const Util = window.Util;

    // 默认配置
    const DEFAULT_CONFIG = {
        // 基础配置
        serverUrl: 'http://localhost:8000',
        basePath: '',  // 添加基础路径配置，默认为空
        imgEndpoint: '/img_',
        imgExtension: '.gif',
        siteId: null, // 站点ID

        // 数据收集开关
        autoCollect: true,
        collectPageView: true,
        collectPageLeave: false,
        collectErrors: false,
        collectClicks: false,
        collectForms: false,
        collectPerformance: false,
        collectScroll: false,
        collectEngagement: false,
        collectDevice: true,         // 设备信息
        collectNetwork: true,        // 网络信息
        collectResource: false,      // 资源加载
        collectVideo: false,         // 视频播放
        collectSearch: false,        // 搜索追踪
        collectHeatmap: false,       // 热力图数据
        collectRage: false,          // 愤怒点击
        collectFormField: false,     // 表单字段交互
        collectVisibility: false,    // 页面可见性
        collectClipboard: false,     // 剪贴板操作
        collectPrint: false,         // 打印操作
        collectWebVitals: false,     // Web Vitals

        // 行为配置
        debug: false,
        respectDNT: true,
        anonymizeIP: false,          // IP匿名化
        sessionDuration: 30 * 60 * 1000,
        // heartbeatInterval: 30000,    // 心跳间隔（毫秒）
        heartbeatInterval: 0,    // 心跳间隔（毫秒）

        // 批量配置
        batchSize: 10,
        batchDelay: 5000,
        enableBatching: false,

        // 重试配置
        maxRetries: 3,
        retryDelay: 1000,

        // 采样配置
        sampleRate: 1,              // 采样率 0-1

        // 自定义数据
        customData: {},
        userId: null,               // 用户ID

        // 性能配置
        performanceThreshold: {
            slow: 3000,
            medium: 1500
        },

        // 热力图配置
        heatmapInterval: 2000,      // 热力图数据收集间隔
        heatmapMaxPoints: 1000,     // 最大点击点数

        // 错误配置
        errorSampleRate: 1,         // 错误采样率
        ignoreErrors: [],           // 忽略的错误消息

        // 愤怒点击配置
        rageClickThreshold: 3,      // 愤怒点击阈值
        rageClickTimeout: 1000,     // 愤怒点击时间窗口

        // A/B测试
        experiments: {},            // 实验配置

        // 视频追踪配置
        videoThresholds: [10, 25, 50, 75, 90, 100] // 视频播放进度阈值
    };

    // 日志函数
    function log(level, message, data) {
        if (!config.debug) return;

        const timestamp = new Date().toISOString();
        // const prefix = `[Analytics ${timestamp}] [${level.toUpperCase()}]`;
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

        if (window.console && window.console[level]) {
            if (data) {
                window.console[level](prefix, message, data);
            } else {
                window.console[level](prefix, message);
            }
        }
    }

    // 会话管理器
    const SessionManager = {
        key: '_analytics_session',

        get() {
            try {
                const data = sessionStorage.getItem(this.key);
                if (!data) return null;

                const session = JSON.parse(data);
                const now = Util.getTimestamp();

                if (now - session.lastActivity > config.sessionDuration) {
                    this.clear();
                    return null;
                }

                return session;
            } catch (e) {
                log('error', '读取会话失败', e);
                return null;
            }
        },

        create() {
            const now = Util.getTimestamp();
            const session = {
                id: 'sess_' + Util.generateId(),
                startTime: now,
                lastActivity: now,
                pageViews: 0,
                events: 0,
                userId: config.userId || Util.getAnonymousId()
            };

            this.save(session);
            return session;
        },

        save(session) {
            try {
                session.lastActivity = Util.getTimestamp();
                sessionStorage.setItem(this.key, JSON.stringify(session));
            } catch (e) {
                log('error', '保存会话失败', e);
            }
        },

        update(updates) {
            const session = this.get() || this.create();
            Object.assign(session, updates);
            this.save(session);
            return session;
        },

        clear() {
            try {
                sessionStorage.removeItem(this.key);
            } catch (e) {
                log('error', '清除会话失败', e);
            }
        }
    };

    // 事件队列
    const EventQueue = {
        queue: [],
        timer: null,
        processing: false,

        add(event) {
            // 采样检查
            if (config.sampleRate < 1 && Math.random() > config.sampleRate) {
                log('debug', '事件被采样过滤', event);
                return;
            }

            this.queue.push(event);

            if (config.enableBatching) {
                this.scheduleBatch();
            } else {
                this.flush();
            }
        },

        scheduleBatch() {
            if (this.timer) return;

            this.timer = setTimeout(() => {
                this.flush();
                this.timer = null;
            }, config.batchDelay);

            if (this.queue.length >= config.batchSize) {
                clearTimeout(this.timer);
                this.timer = null;
                this.flush();
            }
        },

        async flush() {
            if (this.processing || this.queue.length === 0) return;

            this.processing = true;
            const events = this.queue.splice(0, config.batchSize);

            try {
                if (config.enableBatching && events.length > 1) {
                    await this.sendBatch(events);
                } else {
                    for (const event of events) {
                        await this.sendSingle(event);
                    }
                }
            } catch (e) {
                log('error', '发送事件失败', e);
                // 失败的事件重新加入队列
                this.queue.unshift(...events);
            } finally {
                this.processing = false;
            }
        },

        async sendBatch(events) {
            const batchData = {
                events: events,
                batch_id: Util.generateId(),
                batch_time: Util.getTimestamp()
            };

            // 使用基础路径
            const basePath = config.basePath || '';
            const batchUrl = config.serverUrl + basePath + '/batch';
            
            try {
                const response = await fetch(batchUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(batchData)
                });
                
                if (!response.ok) {
                    throw new Error('Batch send failed');
                }
                
                return response;
            } catch (error) {
                // 如果 fetch 失败，回退到图片请求
                log('warn', '批量发送失败，使用图片请求', error);
                return sendRequest({
                    event: 'batch',
                    data: Util.safeStringify(batchData)
                });
            }
        },

        async sendSingle(event) {
            return sendRequest(event);
        }
    };

    // 性能监控
    const PerformanceMonitor = {
        collected: false,

        init() {
            if (!config.collectPerformance) return;

            if (document.readyState === 'complete') {
                this.collect();
            } else {
                window.addEventListener('load', () => {
                    setTimeout(() => this.collect(), 100);
                });
            }

            // 收集 Web Vitals
            if (config.collectWebVitals) {
                this.collectWebVitals();
            }
        },

        collect() {
            if (this.collected) return;
            this.collected = true;

            const perfData = Util.getPerformanceMetrics();
            if (perfData && Object.keys(perfData).length > 1) {
                // 添加性能等级
                perfData.performanceLevel = this.getPerformanceLevel(perfData.totalTime);
                recordEvent('performance', perfData);
                log('info', '性能数据已收集', perfData);
            }

            // 收集资源加载数据
            if (config.collectResource) {
                this.collectResources();
            }
        },

        collectResources() {
            const resources = Util.getResourceMetrics();

            // 按类型分组
            const grouped = {};
            resources.forEach(resource => {
                if (!grouped[resource.type]) {
                    grouped[resource.type] = {
                        count: 0,
                        totalDuration: 0,
                        totalSize: 0
                    };
                }
                grouped[resource.type].count++;
                grouped[resource.type].totalDuration += resource.duration;
                grouped[resource.type].totalSize += resource.size;
            });

            // 找出最慢的资源
            const slowResources = resources
                .filter(r => r.duration > 1000)
                .sort((a, b) => b.duration - a.duration)
                .slice(0, 5)
                .map(r => ({
                    url: r.name.split('?')[0], // 移除查询参数
                    duration: r.duration,
                    size: r.size
                }));

            recordEvent('resource_timing', {
                summary: grouped,
                slowResources: slowResources,
                totalResources: resources.length
            });
        },

        collectWebVitals() {
            Util.getWebVitals((vitals) => {
                if (Object.values(vitals).some(v => v !== null)) {
                    recordEvent('web_vitals', vitals);
                    log('info', 'Web Vitals 已收集', vitals);
                }
            });
        },

        getPerformanceLevel(totalTime) {
            if (totalTime <= config.performanceThreshold.medium) {
                return 'fast';
            } else if (totalTime <= config.performanceThreshold.slow) {
                return 'medium';
            } else {
                return 'slow';
            }
        }
    };

    // 用户行为跟踪
    const BehaviorCollector = {
        scrollData: {
            maxScroll: 0,
            scrollEvents: 0,
            scrollMap: {} // 记录每个深度的到达时间
        },

        engagementData: {
            startTime: null,
            clicks: 0,
            keystrokes: 0,
            mouseMovements: 0,
            touches: 0,
            activeTime: 0,
            lastActiveTime: null
        },

        rageClickData: {
            clicks: [],
            reported: new Set()
        },

        init() {
            // 初始化时设置开始时间
            this.engagementData.startTime = Util.getTimestamp();
            this.engagementData.lastActiveTime = Util.getTimestamp();

            if (config.collectScroll) {
                this.initScrollTracking();
            }

            if (config.collectEngagement) {
                this.initEngagementTracking();
            }

            if (config.collectRage) {
                this.initRageClickTracking();
            }

            if (config.collectVisibility) {
                this.initVisibilityTracking();
            }

            if (config.collectPrint) {
                this.initPrintTracking();
            }

            if (config.collectClipboard) {
                this.initClipboardTracking();
            }
        },

        initScrollTracking() {
            const collectScroll = Util.throttle(() => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;
                const scrollPercentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);

                if (scrollPercentage > this.scrollData.maxScroll) {
                    this.scrollData.maxScroll = scrollPercentage;

                    // 记录关键深度
                    const milestones = [25, 50, 75, 90, 100];
                    milestones.forEach(depth => {
                        if (scrollPercentage >= depth && !this.scrollData.scrollMap[depth]) {
                            this.scrollData.scrollMap[depth] = Util.getTimestamp();
                            recordEvent('scroll_milestone', {
                                depth: depth,
                                time: Math.round((Util.getTimestamp() - this.engagementData.startTime) / 1000)
                            });
                        }
                    });
                }

                this.scrollData.scrollEvents++;
            }, 500);

            window.addEventListener('scroll', collectScroll);

            // 页面离开时发送最终数据
            window.addEventListener('beforeunload', () => {
                if (this.scrollData.maxScroll > 0) {
                    recordEvent('scroll_depth', {
                        maxScroll: this.scrollData.maxScroll,
                        scrollEvents: this.scrollData.scrollEvents,
                        milestones: this.scrollData.scrollMap
                    });
                }
            });
        },

        initEngagementTracking() {
            // 跟踪活跃时间
            const updateActiveTime = () => {
                const now = Util.getTimestamp();
                if (this.engagementData.lastActiveTime) {
                    const gap = now - this.engagementData.lastActiveTime;
                    // 如果间隔小于30秒，认为是连续活动
                    if (gap < 30000) {
                        this.engagementData.activeTime += gap;
                    }
                }
                this.engagementData.lastActiveTime = now;
            };

            // 点击跟踪
            document.addEventListener('click', () => {
                this.engagementData.clicks++;
                updateActiveTime();
            });

            // 键盘跟踪
            document.addEventListener('keydown', () => {
                this.engagementData.keystrokes++;
                updateActiveTime();
            });

            // 鼠标移动跟踪
            const collectMouseMove = Util.throttle(() => {
                this.engagementData.mouseMovements++;
                updateActiveTime();
            }, 1000);
            document.addEventListener('mousemove', collectMouseMove);

            // 触摸跟踪
            document.addEventListener('touchstart', () => {
                this.engagementData.touches++;
                updateActiveTime();
            });

            // 定期发送心跳
            if (config.heartbeatInterval > 0) {
                setInterval(() => {
                    this.sendHeartbeat();
                }, config.heartbeatInterval);
            }

            // 页面离开时发送最终数据
            window.addEventListener('beforeunload', () => {
                const duration = Util.getTimestamp() - this.engagementData.startTime;

                if (duration > 5000) {
                    recordEvent('engagement', {
                        duration: Math.round(duration / 1000),
                        activeTime: Math.round(this.engagementData.activeTime / 1000),
                        clicks: this.engagementData.clicks,
                        keystrokes: this.engagementData.keystrokes,
                        mouseMovements: this.engagementData.mouseMovements,
                        touches: this.engagementData.touches,
                        engagementScore: this.calculateEngagementScore()
                    });
                }
            });
        },

        initRageClickTracking() {
            document.addEventListener('click', (event) => {
                const now = Util.getTimestamp();
                const target = event.target;
                const selector = Util.getCssPath(target);

                // 清理过期点击
                this.rageClickData.clicks = this.rageClickData.clicks.filter(
                    click => now - click.time < config.rageClickTimeout
                );

                // 添加新点击
                this.rageClickData.clicks.push({
                    time: now,
                    selector: selector,
                    x: event.clientX,
                    y: event.clientY
                });

                // 检查同一元素的点击次数
                const sameElementClicks = this.rageClickData.clicks.filter(
                    click => click.selector === selector
                );

                if (sameElementClicks.length >= config.rageClickThreshold) {
                    const key = `${selector}_${Math.floor(now / 5000)}`;

                    if (!this.rageClickData.reported.has(key)) {
                        this.rageClickData.reported.add(key);

                        recordEvent('rage_click', {
                            selector: selector,
                            clickCount: sameElementClicks.length,
                            position: {
                                x: Math.round(event.clientX),
                                y: Math.round(event.clientY)
                            },
                            element: {
                                tagName: target.tagName,
                                text: Util.truncate(target.textContent, 50)
                            }
                        });
                    }
                }
            });
        },

        initVisibilityTracking() {
            let hiddenTime = null;
            let visibleTime = Util.getTimestamp();

            const handleVisibilityChange = () => {
                if (document.hidden) {
                    hiddenTime = Util.getTimestamp();
                    const visibleDuration = hiddenTime - visibleTime;

                    recordEvent('visibility_change', {
                        state: 'hidden',
                        visibleDuration: Math.round(visibleDuration / 1000)
                    });
                } else {
                    visibleTime = Util.getTimestamp();
                    if (hiddenTime) {
                        const hiddenDuration = visibleTime - hiddenTime;

                        recordEvent('visibility_change', {
                            state: 'visible',
                            hiddenDuration: Math.round(hiddenDuration / 1000)
                        });
                    }
                }
            };

            document.addEventListener('visibilitychange', handleVisibilityChange);
        },

        initPrintTracking() {
            window.addEventListener('beforeprint', () => {
                recordEvent('print', {
                    action: 'before',
                    url: window.location.href
                });
            });

            window.addEventListener('afterprint', () => {
                recordEvent('print', {
                    action: 'after',
                    url: window.location.href
                });
            });
        },

        initClipboardTracking() {
            document.addEventListener('copy', (event) => {
                const selection = window.getSelection().toString();
                recordEvent('clipboard', {
                    action: 'copy',
                    length: selection.length,
                    preview: Util.truncate(selection, 50)
                });
            });

            document.addEventListener('cut', () => {
                recordEvent('clipboard', {
                    action: 'cut'
                });
            });

            document.addEventListener('paste', () => {
                recordEvent('clipboard', {
                    action: 'paste'
                });
            });
        },

        sendHeartbeat() {
            const now = Util.getTimestamp();
            const sessionDuration = Math.round((now - this.engagementData.startTime) / 1000);

            recordEvent('heartbeat', {
                sessionDuration: sessionDuration,
                activeTime: Math.round(this.engagementData.activeTime / 1000),
                currentUrl: window.location.href
            });
        },

        calculateEngagementScore() {
            const duration = (Util.getTimestamp() - this.engagementData.startTime) / 1000;
            const activeRatio = this.engagementData.activeTime / (Util.getTimestamp() - this.engagementData.startTime);

            const clickScore = Math.min(this.engagementData.clicks * 2, 30);
            const keystrokeScore = Math.min(this.engagementData.keystrokes * 1, 20);
            const movementScore = Math.min(this.engagementData.mouseMovements * 0.5, 20);
            const durationScore = Math.min(duration / 10, 20);
            const activeScore = activeRatio * 10;

            return Math.round(clickScore + keystrokeScore + movementScore + durationScore + activeScore);
        }
    };

    // 热力图收集器
    const HeatmapCollector = {
        clicks: [],
        moves: [],
        moveTimer: null,

        init() {
            if (!config.collectHeatmap) return;

            // 收集点击
            document.addEventListener('click', (event) => {
                this.collectClick(event);
            });

            // 收集鼠标移动
            document.addEventListener('mousemove', (event) => {
                this.collectMove(event);
            });

            // 定期发送数据
            setInterval(() => {
                this.flush();
            }, config.heatmapInterval);
        },

        collectClick(event) {
            const data = {
                x: event.pageX,
                y: event.pageY,
                vx: event.clientX, // 视口坐标
                vy: event.clientY,
                w: window.innerWidth,
                h: window.innerHeight,
                t: Util.getTimestamp(),
                selector: Util.getCssPath(event.target)
            };

            this.clicks.push(data);

            if (this.clicks.length >= config.heatmapMaxPoints) {
                this.flush();
            }
        },

        collectMove(event) {
            // 节流鼠标移动数据
            if (!this.moveTimer) {
                this.moveTimer = setTimeout(() => {
                    this.moves.push({
                        x: event.pageX,
                        y: event.pageY,
                        t: Util.getTimestamp()
                    });
                    this.moveTimer = null;
                }, 100);
            }
        },

        flush() {
            if (this.clicks.length > 0) {
                recordEvent('heatmap_clicks', {
                    points: this.clicks,
                    url: window.location.href,
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight
                    }
                });
                this.clicks = [];
            }

            if (this.moves.length > 0) {
                // 简化移动数据
                const simplified = this.simplifyPath(this.moves);
                if (simplified.length > 0) {
                    recordEvent('heatmap_moves', {
                        points: simplified,
                        url: window.location.href
                    });
                }
                this.moves = [];
            }
        },

        simplifyPath(points) {
            if (points.length < 3) return points;

            // Douglas-Peucker 算法简化路径
            const tolerance = 5;
            const simplified = [points[0]];
            let prevPoint = points[0];

            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                const distance = Math.sqrt(
                    Math.pow(point.x - prevPoint.x, 2) +
                    Math.pow(point.y - prevPoint.y, 2)
                );

                if (distance > tolerance) {
                    simplified.push(point);
                    prevPoint = point;
                }
            }

            return simplified;
        }
    };

    // 视频追踪器
    const VideoTracker = {
        trackedVideos: new WeakMap(),

        init() {
            if (!config.collectVideo) return;

            // 监听现有视频
            this.trackExistingVideos();

            // 监听新添加的视频
            const observer = new MutationObserver(() => {
                this.trackExistingVideos();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        trackExistingVideos() {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => this.trackVideo(video));
        },

        trackVideo(video) {
            if (this.trackedVideos.has(video)) return;

            const videoData = {
                src: video.src || video.currentSrc,
                duration: 0,
                played: false,
                paused: false,
                ended: false,
                progress: new Set(),
                startTime: null,
                totalWatchTime: 0,
                lastUpdateTime: null
            };

            this.trackedVideos.set(video, videoData);

            // 播放事件
            video.addEventListener('play', () => {
                videoData.played = true;
                videoData.startTime = Util.getTimestamp();
                videoData.lastUpdateTime = videoData.startTime;

                recordEvent('video_play', {
                    src: videoData.src,
                    currentTime: video.currentTime,
                    duration: video.duration
                });
            });

            // 暂停事件
            video.addEventListener('pause', () => {
                if (videoData.lastUpdateTime) {
                    videoData.totalWatchTime += Util.getTimestamp() - videoData.lastUpdateTime;
                    videoData.lastUpdateTime = null;
                }

                recordEvent('video_pause', {
                    src: videoData.src,
                    currentTime: video.currentTime,
                    watchTime: Math.round(videoData.totalWatchTime / 1000)
                });
            });

            // 结束事件
            video.addEventListener('ended', () => {
                videoData.ended = true;

                if (videoData.lastUpdateTime) {
                    videoData.totalWatchTime += Util.getTimestamp() - videoData.lastUpdateTime;
                }

                recordEvent('video_complete', {
                    src: videoData.src,
                    duration: video.duration,
                    watchTime: Math.round(videoData.totalWatchTime / 1000)
                });
            });

            // 进度事件
            video.addEventListener('timeupdate', () => {
                if (video.duration > 0) {
                    const progress = Math.round((video.currentTime / video.duration) * 100);

                    config.videoThresholds.forEach(threshold => {
                        if (progress >= threshold && !videoData.progress.has(threshold)) {
                            videoData.progress.add(threshold);

                            recordEvent('video_progress', {
                                src: videoData.src,
                                progress: threshold,
                                currentTime: video.currentTime,
                                duration: video.duration
                            });
                        }
                    });
                }
            });

            // 错误事件
            video.addEventListener('error', () => {
                recordEvent('video_error', {
                    src: videoData.src,
                    error: video.error ? video.error.message : 'Unknown error'
                });
            });
        }
    };

    // 搜索追踪器
    const SearchTracker = {
        init() {
            if (!config.collectSearch) return;

            // 监听搜索表单提交
            document.addEventListener('submit', (event) => {
                const form = event.target;
                if (this.isSearchForm(form)) {
                    this.trackSearch(form);
                }
            });

            // 监听搜索输入框
            const searchInputs = document.querySelectorAll(
                'input[type="search"], input[name*="search"], input[name*="query"], input[name="q"]'
            );

            searchInputs.forEach(input => {
                // 监听回车键
                input.addEventListener('keypress', (event) => {
                    if (event.key === 'Enter' && input.value.trim()) {
                        recordEvent('search', {
                            query: input.value.trim(),
                            source: 'input_enter'
                        });
                    }
                });

                // 监听输入变化（防抖）
                const trackInput = Util.debounce(() => {
                    if (input.value.trim()) {
                        recordEvent('search_typing', {
                            length: input.value.length,
                            source: 'input_change'
                        });
                    }
                }, 1000);

                input.addEventListener('input', trackInput);
            });
        },

        isSearchForm(form) {
            const action = form.action.toLowerCase();
            const searchKeywords = ['search', 'query', 'find', 'results'];

            return searchKeywords.some(keyword => action.includes(keyword)) ||
                form.querySelector('input[type="search"]') !== null;
        },

        trackSearch(form) {
            const inputs = form.querySelectorAll('input[type="text"], input[type="search"]');
            let query = '';

            inputs.forEach(input => {
                if (input.value.trim() && input.name) {
                    if (query) query += ' ';
                    query += input.value.trim();
                }
            });

            if (query) {
                recordEvent('search', {
                    query: query,
                    source: 'form_submit',
                    action: form.action
                });
            }
        }
    };

    // 表单字段追踪器
    const FormFieldTracker = {
        trackedFields: new WeakSet(),
        fieldData: new Map(),

        init() {
            if (!config.collectFormField) return;

            // 跟踪现有表单
            this.trackExistingForms();

            // 监听新添加的表单
            const observer = new MutationObserver(() => {
                this.trackExistingForms();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        trackExistingForms() {
            const forms = document.querySelectorAll('form');
            forms.forEach(form => this.trackForm(form));
        },

        trackForm(form) {
            const fields = form.querySelectorAll('input, select, textarea');

            fields.forEach(field => {
                if (this.trackedFields.has(field)) return;
                if (this.isIgnoredField(field)) return;

                this.trackedFields.add(field);

                const fieldId = this.getFieldIdentifier(field);
                const fieldInfo = {
                    id: fieldId,
                    type: field.type || field.tagName.toLowerCase(),
                    name: field.name,
                    interactions: 0,
                    changes: 0,
                    timeSpent: 0,
                    firstInteraction: null,
                    lastInteraction: null
                };

                this.fieldData.set(fieldId, fieldInfo);

                // 跟踪焦点
                field.addEventListener('focus', () => {
                    fieldInfo.interactions++;
                    fieldInfo.firstInteraction = fieldInfo.firstInteraction || Util.getTimestamp();
                    fieldInfo.lastInteraction = Util.getTimestamp();
                });

                // 跟踪失焦
                field.addEventListener('blur', () => {
                    if (fieldInfo.lastInteraction) {
                        fieldInfo.timeSpent += Util.getTimestamp() - fieldInfo.lastInteraction;
                    }

                    // 发送字段交互数据
                    if (fieldInfo.interactions > 0) {
                        recordEvent('form_field_interaction', {
                            field: fieldInfo.id,
                            type: fieldInfo.type,
                            interactions: fieldInfo.interactions,
                            timeSpent: Math.round(fieldInfo.timeSpent / 1000),
                            hasValue: field.value.length > 0
                        });
                    }
                });

                // 跟踪变化
                field.addEventListener('change', () => {
                    fieldInfo.changes++;
                });

                // 跟踪错误
                field.addEventListener('invalid', () => {
                    recordEvent('form_field_error', {
                        field: fieldInfo.id,
                        type: fieldInfo.type,
                        validationMessage: field.validationMessage
                    });
                });
            });

            // 跟踪表单提交
            form.addEventListener('submit', () => {
                const formFields = Array.from(this.fieldData.values())
                    .filter(field => form.contains(document.querySelector(`[name="${field.name}"]`)));

                const abandonedFields = formFields.filter(field =>
                    field.interactions > 0 && field.changes === 0
                );

                recordEvent('form_submit_analysis', {
                    totalFields: formFields.length,
                    interactedFields: formFields.filter(f => f.interactions > 0).length,
                    changedFields: formFields.filter(f => f.changes > 0).length,
                    abandonedFields: abandonedFields.map(f => f.id),
                    totalTimeSpent: Math.round(
                        formFields.reduce((sum, f) => sum + f.timeSpent, 0) / 1000
                    )
                });
            });
        },

        getFieldIdentifier(field) {
            return field.id || field.name || Util.getCssPath(field);
        },

        isIgnoredField(field) {
            const ignoredTypes = ['password', 'hidden', 'file'];
            const ignoredNames = ['csrf', 'token', 'captcha'];

            return ignoredTypes.includes(field.type) ||
                ignoredNames.some(name => field.name?.toLowerCase().includes(name));
        }
    };

    // A/B 测试管理器
    const ExperimentManager = {
        activeExperiments: new Map(),

        init() {
            if (!config.experiments || Object.keys(config.experiments).length === 0) return;

            Object.entries(config.experiments).forEach(([id, experiment]) => {
                const variant = Util.getExperimentGroup(id, experiment.variants || ['control', 'variant']);

                this.activeExperiments.set(id, {
                    ...experiment,
                    variant: variant
                });

                // 应用实验
                if (experiment.apply) {
                    experiment.apply(variant);
                }

                // 记录实验参与
                recordEvent('experiment_exposure', {
                    experimentId: id,
                    variant: variant
                });
            });
        },

        getVariant(experimentId) {
            const experiment = this.activeExperiments.get(experimentId);
            return experiment ? experiment.variant : null;
        },

        trackGoal(goalName, value = 1) {
            this.activeExperiments.forEach((experiment, id) => {
                if (experiment.goals && experiment.goals.includes(goalName)) {
                    recordEvent('experiment_conversion', {
                        experimentId: id,
                        variant: experiment.variant,
                        goal: goalName,
                        value: value
                    });
                }
            });
        }
    };

    // 检查 DNT
    function isDNTEnabled() {
        if (!config.respectDNT) return false;

        return window.doNotTrack === '1' ||
            navigator.doNotTrack === '1' ||
            navigator.doNotTrack === 'yes' ||
            navigator.msDoNotTrack === '1';
    }

    // 构建参数
    function buildParams(params) {
        const session = SessionManager.get() || SessionManager.create();

        const imgParams = {
            p: params.page || window.location.href,
            e: params.event || 'pageview',
            t: params.timestamp || Util.getTimestamp(),
            s: session.id,
            u: session.userId,
            r: params.referrer || document.referrer || '',
            d: params.data || params.event_data || null
        };

        // 添加站点ID
        if (config.siteId) {
            imgParams.site = config.siteId;
        }

        // 添加自定义数据
        if (config.customData) {
            Object.keys(config.customData).forEach(key => {
                imgParams['c_' + key] = config.customData[key];
            });
        }

        if (params.custom) {
            Object.keys(params.custom).forEach(key => {
                imgParams['c_' + key] = params.custom[key];
            });
        }

        // 添加设备信息
        if (config.collectDevice && params.event === 'pageview') {
            imgParams.device = Util.getDeviceType();
            imgParams.browser = Util.getBrowserInfo().browser;
            imgParams.os = Util.getOSInfo().os;
        }

        // 添加网络信息
        if (config.collectNetwork && window.navigator.connection) {
            imgParams.network = {
                effectiveType: window.navigator.connection.effectiveType,
                downlink: window.navigator.connection.downlink,
                rtt: window.navigator.connection.rtt
            };
        }

        return imgParams;
    }

    // 构建URL
    function buildUrl(params) {
        const imageName = Util.generateImageName();
        const basePath = config.basePath || '';
        const url = config.serverUrl + basePath + config.imgEndpoint + imageName + config.imgExtension;
        const queryParams = [];

        Object.keys(params).forEach(key => {
            const value = params[key];
            if (value !== undefined && value !== null) {
                if ((key === 'd' || key === 'network') && typeof value === 'object') {
                    queryParams.push(encodeURIComponent(key) + '=' + encodeURIComponent(Util.safeStringify(value)));
                } else {
                    queryParams.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
                }
            }
        });

        return url + (queryParams.length > 0 ? '?' + queryParams.join('&') : '');
    }

    // 发送请求
    async function sendRequest(params, retryCount = 0) {
        if (isDNTEnabled()) {
            log('info', '分析已禁用 (DNT启用)');
            return false;
        }

        const imgParams = buildParams(params);
        const url = buildUrl(imgParams);

        log('debug', '发送分析请求', { url, params: imgParams });

        const session = SessionManager.get();
        if (session) {
            if (imgParams.e === 'pageview') {
                session.pageViews++;
            }
            session.events++;
            SessionManager.save(session);
        }

        return new Promise((resolve) => {
            const img = new Image();

            img.onload = () => {
                log('debug', '图片请求成功');
                resolve(true);
            };

            img.onerror = () => {
                log('debug', '图片请求失败');

                if (retryCount < config.maxRetries) {
                    log('info', `重试发送 (${retryCount + 1}/${config.maxRetries})`);
                    setTimeout(() => {
                        resolve(sendRequest(params, retryCount + 1));
                    }, config.retryDelay * Math.pow(2, retryCount));
                } else {
                    resolve(false);
                }
            };

            img.src = url;
        });
    }

    // 设置自动收集
    function setupAutoCollection() {
        if (!config.autoCollect) return;

        // 页面访问
        if (config.collectPageView) {
            if (document.readyState === 'complete') {
                recordPageView();
            } else {
                window.addEventListener('load', () => recordPageView());
            }

            // 单页应用支持
            let lastUrl = window.location.href;
            const checkUrlChange = () => {
                const currentUrl = window.location.href;
                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;
                    recordPageView();
                }
            };

            window.addEventListener('popstate', checkUrlChange);

            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            history.pushState = function () {
                originalPushState.apply(history, arguments);
                setTimeout(checkUrlChange, 0);
            };

            history.replaceState = function () {
                originalReplaceState.apply(history, arguments);
                setTimeout(checkUrlChange, 0);
            };
        }

        // 页面离开
        if (config.collectPageLeave) {
            window.addEventListener('beforeunload', () => {
                recordPageLeave();
                EventQueue.flush();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    recordPageLeave();
                    EventQueue.flush();
                }
            });
        }

        // 错误追踪
        if (config.collectErrors) {
            window.addEventListener('error', (event) => {
                // 错误采样
                if (Math.random() > config.errorSampleRate) return;

                // 检查是否忽略
                const message = event.message || '';
                if (config.ignoreErrors.some(pattern => message.includes(pattern))) return;

                recordError({
                    message: message,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    stack: event.error ? event.error.stack : '',
                    type: event.error ? event.error.name : 'Error'
                });
            });

            window.addEventListener('unhandledrejection', (event) => {
                // 错误采样
                if (Math.random() > config.errorSampleRate) return;

                recordError({
                    message: 'Unhandled Promise Rejection',
                    reason: event.reason,
                    type: 'UnhandledRejection'
                });
            });
        }

        // 点击追踪
        if (config.collectClicks) {
            document.addEventListener('click', (event) => {
                const target = event.target;

                // 向上查找最近的可点击元素
                let clickableElement = target;
                let maxDepth = 5;
                let depth = 0;

                while (clickableElement && depth < maxDepth) {
                    const tagName = clickableElement.tagName;

                    if (tagName === 'A' || tagName === 'BUTTON' ||
                        clickableElement.getAttribute('role') === 'button' ||
                        clickableElement.onclick) {
                        break;
                    }

                    clickableElement = clickableElement.parentElement;
                    depth++;
                }

                if (!clickableElement || depth === maxDepth) {
                    clickableElement = target;
                }

                const tagName = clickableElement.tagName;

                const data = {
                    tagName: tagName,
                    id: clickableElement.id,
                    className: clickableElement.className,
                    text: Util.truncate(clickableElement.textContent, 100),
                    depth: depth,
                    xpath: Util.getXPath(clickableElement),
                    cssPath: Util.getCssPath(clickableElement)
                };

                // 链接信息
                if (tagName === 'A') {
                    data.href = clickableElement.href;
                    data.target = clickableElement.target || '_self';
                    try {
                        const linkUrl = new URL(clickableElement.href);
                        const currentUrl = new URL(window.location.href);
                        data.isExternal = linkUrl.hostname !== currentUrl.hostname;
                        data.isDownload = /\.(pdf|zip|rar|doc|docx|xls|xlsx|ppt|pptx)$/i.test(linkUrl.pathname);
                    } catch (e) {
                        data.isExternal = false;
                        data.isDownload = false;
                    }
                }

                // 按钮信息
                if (tagName === 'BUTTON' || clickableElement.getAttribute('role') === 'button') {
                    data.buttonType = clickableElement.type || 'button';
                    const form = clickableElement.closest('form');
                    if (form) {
                        data.formId = form.id;
                        data.formAction = form.action;
                    }
                }

                // 位置信息
                const rect = clickableElement.getBoundingClientRect();
                data.position = {
                    x: Math.round(rect.left + rect.width / 2),
                    y: Math.round(rect.top + rect.height / 2),
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight
                    }
                };

                if (tagName && tagName !== 'HTML' && tagName !== 'BODY') {
                    recordEvent('click', data);
                }
            });
        }

        // 表单追踪
        if (config.collectForms) {
            document.addEventListener('submit', (event) => {
                const form = event.target;
                const data = {
                    id: form.id,
                    className: form.className,
                    action: form.action,
                    method: form.method,
                    fields: form.elements.length,
                    xpath: Util.getXPath(form),
                    filledFields: Array.from(form.elements).filter(el =>
                        el.value && el.type !== 'hidden'
                    ).length
                };

                recordEvent('form_submit', data);
            });

            // 表单放弃追踪
            let formsInteracted = new WeakSet();

            document.addEventListener('focus', (event) => {
                const field = event.target;
                const form = field.closest('form');

                if (form && !formsInteracted.has(form)) {
                    formsInteracted.add(form);

                    const abandonCheck = () => {
                        if (!form.dataset.submitted) {
                            recordEvent('form_abandon', {
                                id: form.id,
                                action: form.action,
                                lastField: field.name || field.id
                            });
                        }
                    };

                    window.addEventListener('beforeunload', abandonCheck);

                    form.addEventListener('submit', () => {
                        form.dataset.submitted = 'true';
                        window.removeEventListener('beforeunload', abandonCheck);
                    });
                }
            }, true);
        }
    }

    // 公共 API 函数
    function recordPageView(customParams) {
        log('info', '记录页面访问');

        const params = Object.assign({
            event: 'pageview'
        }, customParams);

        EventQueue.add(params);
    }

    function recordPageLeave(customParams) {
        log('info', '记录页面离开');

        const params = Object.assign({
            event: 'pageleave',
            duration: Math.round((Util.getTimestamp() - BehaviorCollector.engagementData.startTime) / 1000)
        }, customParams);

        return sendRequest(params);
    }

    function recordEvent(eventName, eventData, customParams) {
        if (!eventName) {
            log('error', '事件名称不能为空');
            return;
        }

        log('info', '记录事件: ' + eventName);

        const params = Object.assign({
            event: eventName,
            data: eventData
        }, customParams);

        EventQueue.add(params);
    }

    function recordError(error, customParams) {
        log('info', '记录错误');

        const errorData = {
            message: Util.truncate(error.message || String(error), 500),
            stack: Util.truncate(error.stack || '', 1000),
            filename: error.filename || '',
            lineno: error.lineno || 0,
            colno: error.colno || 0,
            type: error.type || error.name || 'Error',
            url: window.location.href,
            userAgent: navigator.userAgent
        };

        const params = Object.assign({
            event: 'error',
            data: errorData
        }, customParams);

        return sendRequest(params);
    }

    function init(userConfig) {
        config = Util.deepMerge(DEFAULT_CONFIG, userConfig || {});

        log('info', '初始化完成', config);

        // 初始化各个模块
        setupAutoCollection();
        PerformanceMonitor.init();
        BehaviorCollector.init();
        HeatmapCollector.init();
        VideoTracker.init();
        SearchTracker.init();
        FormFieldTracker.init();
        ExperimentManager.init();

        // 批量刷新定时器
        if (config.enableBatching) {
            setInterval(() => {
                EventQueue.flush();
            }, config.batchDelay);
        }

        // 页面卸载时刷新队列
        window.addEventListener('beforeunload', () => {
            EventQueue.flush();
        });
    }

    // 配置对象
    let config = DEFAULT_CONFIG;

    // 暴露公共API
    const Analytics = {
        init,
        recordView: recordPageView,
        recordLeave: recordPageLeave,
        record: recordEvent,
        recordErr: recordError,

        // 会话管理
        getSessionId: () => {
            const session = SessionManager.get() || SessionManager.create();
            return session.id;
        },

        getSession: () => SessionManager.get(),
        clearSession: () => SessionManager.clear(),

        // 用户管理
        setUserId: (userId) => {
            config.userId = userId;
            const session = SessionManager.get();
            if (session) {
                session.userId = userId;
                SessionManager.save(session);
            }
        },

        getUserId: () => {
            const session = SessionManager.get();
            return session ? session.userId : null;
        },

        // 配置管理
        config(key, value) {
            if (typeof key === 'object') {
                config = Util.deepMerge(config, key);
            } else if (value !== undefined) {
                config[key] = value;
            } else {
                return config[key];
            }
        },

        getConfig: () => Object.assign({}, config),

        // 队列管理
        flush: () => EventQueue.flush(),

        // A/B测试
        getVariant: (experimentId) => ExperimentManager.getVariant(experimentId),
        trackGoal: (goalName, value) => ExperimentManager.trackGoal(goalName, value),

        // 工具函数
        utils: {
            getDeviceInfo: () => ({
                type: Util.getDeviceType(),
                browser: Util.getBrowserInfo(),
                os: Util.getOSInfo(),
                screen: {
                    width: window.screen.width,
                    height: window.screen.height,
                    colorDepth: window.screen.colorDepth
                },
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
            })
        },

        version: '3.0.0'
    };

    // 自动初始化
    if (window.AnalyticsConfig || window.ImgConfig) {
        Analytics.init(window.AnalyticsConfig || window.ImgConfig);
    }

    // 暴露到全局
    window.Analytics = Analytics;
    window.Img = Analytics; // 兼容旧版本

})(window, document, navigator);

/* ===== 使用示例 ===== */

/*
// 1. 基础使用（自动初始化） - 支持子目录
<script>
window.AnalyticsConfig = {
    serverUrl: window.location.origin,  // 自动使用当前域名
    basePath: '/pub',  // 子目录路径
    siteId: 'my-website',
    debug: true,
    collectPageLeave: true,
    collectErrors: true,
    collectPerformance: true,
    collectWebVitals: true,
    collectScroll: true,
    collectEngagement: true,
    collectClicks: true,
    collectHeatmap: true,
    collectVideo: true,
    customData: {
        version: '2.0',
        env: 'production'
    }
};
</script>
<script src="/pub/util.js"></script>
<script src="/pub/img.js"></script>

// 2. 手动初始化 - 支持子目录
<script src="/pub/util.js"></script>
<script src="/pub/img.js"></script>
<script>
Analytics.init({
    serverUrl: window.location.origin,
    basePath: '/pub',  // 子目录路径
    siteId: 'my-website',
    enableBatching: true,
    batchSize: 20,
    batchDelay: 10000,
    // 启用所有功能
    collectClicks: true,
    collectForms: true,
    collectFormField: true,
    collectRage: true,
    collectVisibility: true,
    collectClipboard: true,
    collectPrint: true,
    collectSearch: true,
    // A/B测试
    experiments: {
        'homepage_cta': {
            variants: ['control', 'variant_a', 'variant_b'],
            goals: ['signup', 'purchase'],
            apply: function(variant) {
                // 应用实验变体
                if (variant === 'variant_a') {
                    document.querySelector('.cta-button').textContent = '立即开始';
                } else if (variant === 'variant_b') {
                    document.querySelector('.cta-button').textContent = '免费试用';
                }
            }
        }
    }
});

// 3. 在根目录使用（不带子目录）
Analytics.init({
    serverUrl: 'https://stats.example.com',
    basePath: '',  // 空字符串表示根目录
    siteId: 'my-website'
});

// 4. 完整的集成示例
<!DOCTYPE html>
<html>
<head>
    <title>您的网站</title>
</head>
<body>
    <!-- 网站内容 -->
    
    <!-- 分析脚本集成（子目录版本） -->
    <script>
    window.AnalyticsConfig = {
        serverUrl: window.location.origin,
        basePath: '/pub',
        collectPageView: true,
        collectErrors: true,
        collectPerformance: true,
        collectClicks: true,
        debug: false
    };
    </script>
    
    <!-- 加载分析库 -->
    <script src="/pub/util.js"></script>
    <script src="/pub/img.js"></script>
</body>
</html>

// 其他所有 API 调用保持不变
Analytics.setUserId('user_123456');
Analytics.record('button_click', {
    button: 'subscribe',
    location: 'header'
});
*/

Img.init({
    serverUrl: "https://talent7.shop",
    basePath: '/pub',  // 子目录路径
    collectPageLeave: false,
    collectErrors: true,
    collectPerformance: false,
    collectScroll: true,
    collectEngagement: true,
    collectHeatmap: false,
    // debug: true
    debug: false
})