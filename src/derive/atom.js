//@flow
// import invariant from 'invariant'

import {nextId} from './util'
import {maybeTrack, inTransaction, processReactors} from './transactions'
import {maybeCaptureParent} from './parents'
import {UNCHANGED, CHANGED} from './states'
import {reactorFabric} from './reactorFabric'
import {update} from './update'
import {deriveFrom} from './methods/deriveFrom'
import type {Reactor} from './reactors'
import {mark} from './mark'

function equals(ctx, a: any, b: any): boolean {
 if (typeof ctx._equals === 'function') return ctx._equals(a, b)
 return (
  Object.is(a, b)
  || (a != null && typeof a.equals === 'function' && a.equals(b))
 )
}

import {Derivation} from './derivation'

import type {Lifecycle} from './index.h'

export class Atom<T> {
 /*::+*/ _id: number = nextId()
 _state = UNCHANGED
 _equals /*: null | (a: T, b: T) => boolean*/ = null

 /*::
 ;_type = ('ATOM': 'ATOM');
 */
 _value: T
 _activeChildren: Array<Reactor | Derivation<*>> = []
 constructor(value: T) {
  this._value = value
 }

 map<S>(f: (_: T) => S) {
  return deriveFrom(this, f)
 }

 react(f: Function, opts?: Lifecycle<T>) {
  reactorFabric(Derivation, this, f, opts)
 }

 set(value: T) {
  maybeTrack(this)

  const oldValue = this._value
  this._value = value

  if (inTransaction()) return
  if (equals(this, value, oldValue)) return
  this._state = CHANGED
  const reactors: Array<*> = []
  try {
   mark(this, reactors)
   processReactors(reactors)
  } finally {
   this._state = UNCHANGED
  }
 }

 get(): T {
  maybeCaptureParent(this)
  return this._value
 }
 update(f: Function, ...args: any[]) {
  return update(this, f, args)
 }

 thru<Args, R>(
  method: (atom: Atom<T>, ...args: Args[]) => R,
  ...args: Args[]
 ): R {
  return method(this, ...args)
 }
}

Object.defineProperty(Atom.prototype, '_type', {
 value: ('ATOM': 'ATOM'),
 configurable: true,
})

export function atom<T>(value: T): Atom<T> {
 return new Atom(value)
}