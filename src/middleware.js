//@flow

import {
  createStore,
  type StoreCreator,
  type Reducer,
  type Middleware,
  type Dispatch,
} from 'redux'

import {type Carrier, is} from './carrier/carrier'
import type {Domain} from './domain'
import {Store} from './store/store'
import {incSeq} from './id'

function middleware<State>({
  store,
  // dispatch,
  getState,
  next,
  data,
}: {
  store: Store<State>,
  dispatch: Dispatch,
  getState: () => State,
  next: *,
  data: Carrier<any>,
}) {
  const unwrapped = data.plain()
  next(unwrapped)
  store.seq = incSeq(store.seq)
  data.dispose.disposed(unwrapped)
  store.update$.next({data, state: getState()})
  return data
}

function middlewareCurry<State>(
  store: Store<State>
): Middleware<State> {
  return ({dispatch, getState}) => (next) => (data) => {
    if (!is(data)) {
      console.log(data, typeof data)
      if (typeof data === 'object' && data != null && typeof data.type === 'string')
        return next(data)
      return
    }
    if (data.isSent) {
      console.log('already sent', data)
      return
    }
    if (!store.uniq.isUniq(data)) return
    return middleware({
      dispatch, getState, next, data, store,
    })
  }
}

export function effectorEnhancer<T>(
  domains: Array<Domain<T>> = [],
  storeContext: Store<T>
) {
  return (createStore: StoreCreator<T>): StoreCreator<T> => (
    reducer, preloadedState, enhancer
  ): $todo => {
    //console.error('effect enhancer')
    // storeContext.scopeName = []
    //$off
    const store = createStore(reducer, preloadedState, enhancer)
    // storeContext.injector.setStore(store)
    let dispatch = store.dispatch

    const middlewareAPI = {
      getState: () => store.getState(),
      dispatch: (action) => dispatch(action)
    }
    dispatch = middlewareCurry(storeContext)(middlewareAPI)(store.dispatch)
    storeContext.dispatch = dispatch
    storeContext.stateGetter = middlewareAPI.getState
    //storeContext.reduxSubscribe = store.subscribe
    //storeContext.getState = storeContext.stateGetter
    //storeContext.subscribe = storeContext.reduxSubscribe
    //storeContext.replaceReducer = store.replaceReducer
    // domains.forEach(dom => storeContext.connect(dom))
    return {
      // ...storeContext,
      ...store,
      getState: middlewareAPI.getState,
      dispatch,
      // stateGetter: store.getState,
      // reduxSubscribe: store.subscribe
    }
  }
}

export function getStore<State>(
  description: string,
  reducer: Reducer<State>,
): Store<State> {
  const store: Store<State> = new Store
  store.scopeName = [description]
  const storeContext = createStore(
    reducer, //$off
    effectorEnhancer([], store)
  )
  // store.injector.saveStatic(reducer)
  // store.subscribe(() => { storeContext.state$.next(store.getState()) })
  //$off
  store.ctx = storeContext
  return store
}

