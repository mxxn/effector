//@flow

import type {Store} from 'redux'
import {Stream, from} from 'most'
import {async as subject, type Subject} from 'most-subject'

import type {ID, Tag, Domain, Effect, Event} from './index.h'
import {counter, toTag} from './index.h'

import {PING, PONG, type Config} from './config'

export function createDomain<State>(
  store: Store<State>,
  domainName: string = ''
): Domain<State> {
  const redux: any = store
  const config: Config = redux.dispatch({
    type: PING,
  }).payload
  const addPlainHandler = (name, fn) => {
    config.plain.set(name, fn)
  }
  const state$: Stream<State> = from(redux)
    .map(() => store.getState())
    .multicast()
  return DomainConstructor(
    domainName,
    redux.dispatch,
    store.getState,
    state$,
    new Map,
    addPlainHandler,
  )
}

export function domain<State>(
  domainName: string,
  dispatch: <T>(value: T) => T,
  getState: () => State,
  state$: Stream<State>,
): Domain<State> {
  return DomainConstructor(
    domainName,
    dispatch,
    getState,
    state$,
  )
}

export function rootDomain<State>(
  domainName: string = ''
): Domain<State> {

  const addPlainHandler = (name, fn) => {
    config.plain.set(name, fn)
  }
  let redux: any
  let reduxStore: Store<State>
  const config: Config = {
    plain: new Map()
  }
  function dispatch<T>(data: T): T {
    return redux.dispatch(data)
  }
  function getState(): State {
    return reduxStore.getState()
  }

  const state$: Subject<State> = subject()
  function register(store: Store<State>) {
    redux = reduxStore = store
    const pong = redux.dispatch({
      type: PING,
    })
    if (pong) {
      const plain: Map<*, *> = pong.payload.plain
      const oldPlain = config.plain
      for (const [key, val] of oldPlain.entries()) {
        if (!plain.has(key)) {
          plain.set(key, val)
        }
      }
      config.plain = plain
    }
    //$off
    from(store)
      .map(() => getState())
      .observe(state => state$.next(state))
  }
  const domain: Domain<State> = DomainConstructor(
    domainName,
    dispatch,
    getState,
    state$,
    new Map,
    addPlainHandler
  )
  domain.register = register
  return domain
}

const nextPayloadID = counter()
const nextEventID = counter()

function DomainConstructor<State>(
  domainName: string,
  dispatch: <T>(value: T) => T,
  getState: () => State,
  state$: Stream<State>,
  events = new Map,
  addPlainHandler: <T>(name: string, fn: (data: T) => any) => void = () => {}
): Domain<State> {

  return {
    register(store) {
      console.warn(`Not implemented`)
    },
    effect<Params, Done, Fail>(
      name: string
    ): Effect<Params, Done, Fail, State> {
      return EffectConstructor(
        domainName,
        dispatch,
        getState,
        state$,
        events,
        name
      )
    },
    domain(name: string): Domain<State> {
      return DomainConstructor(
        [domainName, name].join('/'),
        dispatch,
        getState,
        state$,
        events,
        addPlainHandler,
      )
    },
    event<Payload>(
      name: string
    ): Event<Payload, State> {
      return EventConstructor(
        domainName,
        dispatch,
        getState,
        state$,
        events,
        name
      )
    },
    typeConstant<Payload>(
      name: string
    ): Event<Payload, State> {
      const action$: Subject<Payload> = subject()
      addPlainHandler(name, data => {
        action$.next(data)
      })
      const result = EventConstructor(
        '',
        dispatch,
        getState,
        state$,
        events,
        name,
        action$
      )
      return result
    },
  }
}

function EffectConstructor<State, Params, Done, Fail>(
  domainName: string,
  dispatch: <T>(value: T) => T,
  getState: () => State,
  state$: Stream<State>,
  events,
  name: string
): Effect<Params, Done, Fail, State> {
  const handlers = new Set
  const eventID = nextEventID()
  const nextSeq = counter()
  const action$: Subject<Params> = subject()
  const getType = () => toTag(domainName, name)
  handlers.add((payload, state) => action$.next(payload))
  // handlers.add((payload, state) => state$.next(state))
  let using: (params: Params) => Promise<Done> = never
  function use(thunk: (params: Params) => Promise<Done>) {
    using = thunk
  }
  const create = (payload: Params) => ({
    type: getType(),
    payload,
    meta: {
      index: nextPayloadID(),
      eventID,
      seq: nextSeq(),
    },
  })
  const effect = (params: Params) => {
    let run = () => {
      run = () => {}
      using(params).then(
        result => {
          const data = {params, result}
          dispatch(done(data))
          resolve(data)
        },
        error => {
          const data = {params, error}
          dispatch(fail(data))
          reject(data)
        },
      )
    }
    const runner = (dispatchHook) => {
      if (canDispatch) {
        const dispatcher = dispatchHook
          ? dispatchHook
          : dispatch
        canDispatch = false
        dispatcher(result)
        for (const handler of handlers) {
          handler(params, getState())
        }
        // action$.next(params)
        run()
      }
    }
    let resolve = (val) => {}
    let reject = (val) => {}
    const doneP: Promise<{params: Params, result: Done}> = new Promise(rs => resolve = rs)
    const failP: Promise<{params: Params, error: Fail}> = new Promise(rs => reject = rs)
    const toSend = Promise.resolve(params)
    const result = create(params)
    let canDispatch = true
    return {
      ...result,
      raw() {
        return result
      },
      send(dispatchHook) {
        runner(dispatchHook)
        return toSend
      },
      done() {
        runner()
        return doneP
      },
      fail() {
        runner()
        return failP
      },
      promise() {
        runner()
        return Promise.race([
          doneP,
          failP.then(data => Promise.reject(data)),
        ])
      }
    }
  }
  const done: Event<{params: Params, result: Done}, State> = EventConstructor(
    domainName,
    dispatch,
    getState,
    state$,
    events,
    [name, 'done'].join(' ')
  )
  const fail: Event<{params: Params, error: Fail}, State> = EventConstructor(
    domainName,
    dispatch,
    getState,
    state$,
    events,
    [name, 'fail'].join(' ')
  )
  function watch<R>(fn: (params: Params, state: State) => R) {
    handlers.add((params, state) => {
      const result = fn(params, state)
      safeDispatch(result, dispatch)
    })
  }
  function epic<R>(
    handler: (
      data$: Stream<Params>,
      state$: Stream<State>
    ) => Stream<R>
  ): Stream<R> {
    const result = handler(action$, state$)
      .multicast()
    result.observe(data => safeDispatch(data, dispatch))
    return result
  }
  effect.use = use
  effect.getType = getType
  effect.done = done
  effect.fail = fail
  effect.watch = watch
  effect.epic = epic
  return effect
}

function safeDispatch(data, dispatch) {
  if (
    typeof data === 'object'
    && data != null
    && typeof data.type === 'string'
  ) {
    dispatch(data)
  }
}

function EventConstructor<State, Payload>(
  domainName: string,
  dispatch: <T>(value: T) => T,
  getState: () => State,
  state$: Stream<State>,
  events,
  name: string,
  action$: Subject<Payload> = subject()
): Event<Payload, State> {
  const eventID = nextEventID()
  const nextSeq = counter()
  const getType = () => toTag(domainName, name)
  const handlers = new Set
  function watch<R>(
    fn: (params: Payload, state: State) => R
  ) {
    handlers.add(fn)
  }
  handlers.add((payload, state) => action$.next(payload))
  // handlers.add((payload, state) => state$.next(state))
  function epic<R>(
    handler: (
      data$: Stream<Payload>,
      state$: Stream<State>
    ) => Stream<R>
  ): Stream<R> {
    const result = handler(action$, state$)
      .multicast()
    result.observe(data => safeDispatch(data, dispatch))
    return result
  }
  const create = (payload: Payload) => ({
    type: getType(),
    payload,
    meta: {
      index: nextPayloadID(),
      eventID,
      seq: nextSeq(),
    },
  })
  const eventInstance = (payload: Payload) => {
    const toSend = Promise.resolve(payload)
    const result = create(payload)
    let canDispatch = true
    return {
      ...result,
      raw() {
        return result
      },
      send(dispatchHook) {
        if (canDispatch) {
          const dispatcher = dispatchHook
            ? dispatchHook
            : dispatch
          canDispatch = false
          dispatcher(result)
          for (const handler of handlers) {
            handler(payload, getState())
          }
          // action$.next(payload)
        }
        return toSend
      },
    }
  }
  eventInstance.getType = getType
  //$off
  eventInstance.toString = getType
  eventInstance.watch = watch
  eventInstance.epic = epic

  events.set(getType(), eventInstance)
  return eventInstance
}


function never(props: any): Promise<any> {
  console.warn(`


  Running an effect without implementation

`, props)
  return new Promise(() => {})
}

