/* global __DEV__, HAS_CLIENT_LOADING, ROC_CLIENT_LOADING, ROC_PATH, HAS_REDUX_REDUCERS, document, window,
 HAS_REDUX_SAGA, REDUX_SAGAS, I18N_LOCALES, USE_I18N_POLYFILL, USE_REACT_ROUTER_SCROLL_ASYNC,
 HAS_APOLLO, APOLLO */
/* eslint-disable global-require */
import React from 'react';
import ReactDOM from 'react-dom';
import useRouterHistory from 'react-router/lib/useRouterHistory';
import applyRouterMiddleware from 'react-router/lib/applyRouterMiddleware';
import createHistory from 'history/lib/createBrowserHistory';
import { supportsHistory } from 'history/lib/DOMUtils';
import debug from 'debug';
import { useRedial } from 'react-router-redial';

import { rocConfig } from '../shared/universal-config';

import renderToDOM from './render-to-dom';

const clientDebug = debug('roc:client');

const basename = ROC_PATH === '/' ? '' : ROC_PATH;

function compose(funcs) {
    if (funcs.length === 0) {
        return (arg) => arg;
    }

    const last = funcs[funcs.length - 1];
    const rest = funcs.slice(0, -1);
    return (...args) => rest.reduceRight((composed, f) => f(composed), last(...args));
}


/**
 * Client entry point for React applications.
 *
 * @example
 * import { createClient } from 'roc-web-react/app/client';
 *
 * const server = createClient({
 *     createRoutes: routes,
 *     createStore: store,
 *     mountNode: 'application',
 *     routerMiddlewareConfig,
 * });
 *
 * @param {rocClientOptions} options - Options for the client
 */
export default function createClient({
    createRoutes,
    createStore,
    mountNode,
    routerMiddlewareConfig,
}) {
    if (!createRoutes) {
        throw new Error('createRoutes needs to be defined');
    }

    if (!mountNode) {
        throw new Error('mountNode needs to be defined');
    }

    if (rocConfig) {
        debug.enable(rocConfig.runtime.debug.client);
    }

    if (__DEV__ && rocConfig.dev.a11y) {
        if (rocConfig.runtime.ssr) {
            clientDebug('You will see a "Warning: React attempted to reuse markup in a container but the checksum was' +
                ' invalid." message. That\'s because a11y is enabled.');
        }

        require('react-a11y')(React, {
            ReactDOM,
            // These needs to be added for Redux Devtools to be ignored by A11Y
            filterFn: (name) => [
                'LogMonitorButton',
                'LogMonitorAction',
                'JSONValueNode',
                'JSONNestedNode',
                'JSONArrow',
            ].indexOf(name) === -1,
        });
    }

    const render = () => {
        const forceRefreshSetting = rocConfig.runtime.history.forceRefresh;
        let history = useRouterHistory(createHistory)({
            basename,
            forceRefresh: typeof forceRefreshSetting === 'function'
                ? forceRefreshSetting()
                : forceRefreshSetting,
        });

        let routes;
        let locals = {
            history,
        };
        const createComponent = [(component) => component];
        const createDevComponent = [(component) => component];
        if (HAS_APOLLO && !HAS_REDUX_REDUCERS) {
            const { ApolloProvider, ApolloClient, createNetworkInterface } = require('react-apollo');

            const apolloOptions = require(APOLLO).client({ settings: rocConfig, createNetworkInterface });
            const apollo = new ApolloClient({
                connectToDevTools: __DEV__,
                initialState: window.APOLLO_STATE,
                ...apolloOptions,
            });
            createComponent.push((component) => (
                <ApolloProvider client={apollo}>
                    {component}
                </ApolloProvider>
            ));
        } else if (HAS_REDUX_REDUCERS && createStore) {
            let Provider;
            const extraMiddlewares = [];
            const extraReducers = {};
            const providerProps = {};

            if (HAS_APOLLO) {
                const { ApolloProvider, ApolloClient, createNetworkInterface } = require('react-apollo');

                Provider = ApolloProvider;
                const apolloOptions = require(APOLLO).client({ settings: rocConfig, createNetworkInterface });
                const apollo = new ApolloClient({
                    connectToDevTools: __DEV__,
                    ...apolloOptions,
                });
                extraMiddlewares.push(apollo.middleware());
                extraReducers.apollo = apollo.reducer();
                providerProps.client = apollo;
            } else {
                Provider = require('react-redux').Provider;
            }

            const { syncHistoryWithStore } = require('react-router-redux');

            const store = createStore(history, window.FLUX_STATE, extraReducers, extraMiddlewares);
            providerProps.store = store;

            if (HAS_REDUX_SAGA) {
                store.runSaga(require(REDUX_SAGAS).default);
            }

            history = syncHistoryWithStore(history, store, {
                // We do not want to use adjustUrlOnReplay if the browser does
                // not support the history API with pushState since this can lead
                // to redirect loops https://github.com/reactjs/react-router-redux/issues/285
                adjustUrlOnReplay: supportsHistory(),
            });

            routes = createRoutes(store);
            locals = {
                dispatch: store.dispatch,
                getState: store.getState,
                history,
            };

            createComponent.push((component) => (
                <Provider {...providerProps}>
                    {component}
                </Provider>
            ));

            if (__DEV__) {
                if (rocConfig.dev.redux.devTools.enabled && !window.devToolsExtension) {
                    const DevTools = require('./dev-tools').default;

                    createDevComponent.push((component) => (
                        <Provider {...providerProps}>
                            <span>
                                {component}
                                <DevTools />
                            </span>
                        </Provider>
                    ));
                } else if (rocConfig.dev.redux.devTools.enabled) {
                    console.log('Found Redux Devtools Chrome extension, will use that over default one.');
                }
            }
        } else {
            routes = createRoutes();
        }

        if (__DEV__ && rocConfig.dev.yellowbox.enabled) {
            const YellowBox = require('yellowbox-react').default;

            /* eslint-disable no-console */
            console.ignoredYellowBox = rocConfig.dev.yellowbox.ignore;
            /* eslint-enable */

            createDevComponent.push((component) => (
                <span>
                    {component}
                    <YellowBox />
                </span>
            ));
        }

        const node = document.getElementById(mountNode);
        let updateScroll = () => {};

        const middlewares = [
            useRedial({
                ...routerMiddlewareConfig['react-router-redial'],
                locals,
                initialLoading: HAS_CLIENT_LOADING ? require(ROC_CLIENT_LOADING).default : undefined,
                beforeTransition: rocConfig.runtime.fetch.client.beforeTransition,
                afterTransition: rocConfig.runtime.fetch.client.afterTransition,
                parallel: rocConfig.runtime.fetch.client.parallel,
                onCompleted: (type) => {
                    if (type === 'beforeTransition') {
                        updateScroll();
                    }

                    if (routerMiddlewareConfig['react-router-redial'].onCompleted) {
                        routerMiddlewareConfig['react-router-redial'].onCompleted(type);
                    }
                },
            }),
        ];

        if (USE_REACT_ROUTER_SCROLL_ASYNC) {
            const useScroll = require('react-router-scroll-async/lib/useScroll');

            middlewares.unshift(
                useScroll({
                    ...routerMiddlewareConfig['react-router-scroll-async'],
                    updateScroll: (cb) => { updateScroll = cb; },
                })
            );
        }

        renderToDOM(
            {
                createComponent: compose(createComponent),
                history,
                routes,
                routerRenderFn: applyRouterMiddleware(...middlewares),
            },
            node
        );

        if (__DEV__) {
            const devNode = document.createElement('div');
            node.parentNode.insertBefore(devNode, node.nextSibling);
            ReactDOM.render(compose(createDevComponent)(null), devNode);
        }
    };

    if (USE_I18N_POLYFILL) {
        const intlLoader = !global.Intl ?
            require('bundle?name=intl!intl') :
            (cb) => cb();

        // intl's locale data identifies locales by the shortest ISO 639 language code.
        // https://tools.ietf.org/html/rfc5646
        const language = (locale) => /^([^-]+)/.exec(locale)[0];

        intlLoader(() => {
            const areIntlLocalesSupported = require('intl-locales-supported');

            const localeModules = I18N_LOCALES.map(locale => new Promise((resolve) => {
                if (!areIntlLocalesSupported(locale)) {
                    // eslint-disable-next-line
                    require('bundle!intl/locale-data/jsonp/' + language(locale))(resolve);
                } else {
                    resolve();
                }
            }));

            Promise.all(localeModules).then(render);
        });
    } else {
        render();
    }
}
