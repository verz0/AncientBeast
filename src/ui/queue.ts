/* eslint-env dom, mocha */
import { throttle } from 'underscore';
import { Creature } from '../creature';

const CONST = {
	animDurationMS: 500,
};

export class Queue {
	private element: HTMLElement;
	private vignettes: Array<Vignette>;
	private eventHandlers: QueueEventHandlers;

	static IMMEDIATE = 1;

	constructor(queueElement: HTMLElement, eventHandlers: QueueEventHandlers = {}) {
		this.element = queueElement;
		this.element.innerHTML = '';
		this.vignettes = [];
		this.eventHandlers = eventHandlers;

		refactor.stopGap.init();
	}

	setQueue(creatureQueue, activeCreature, turnNumber: number) {
		refactor.stopGap.setTurnNumber(turnNumber);
		refactor.stopGap.setCreatureQueue(creatureQueue);

		const creatures = refactor.creatureQueue.getCurrentQueue(creatureQueue, activeCreature);
		const nextCreatures = refactor.creatureQueue.getNextQueue(creatureQueue);

		creatures.forEach((c) =>
			refactor.stopGap.updateCreatureDelayStatus(c, creatures, nextCreatures, turnNumber),
		);
		nextCreatures.forEach((c) =>
			refactor.stopGap.updateCreatureDelayStatus(c, creatures, nextCreatures, turnNumber + 1),
		);

		const nextVignettes = Queue.getNextVignettes(
			creatures,
			nextCreatures,
			turnNumber,
			this.eventHandlers,
		);
		this.setVignettes(nextVignettes);
	}

	refresh() {
		this.vignettes.forEach((v) => v.refresh());
	}

	empty(immediately) {
		refactor.stopGap.init();
		if (immediately === Queue.IMMEDIATE) {
			this.vignettes = [];
			this.element.innerHTML = '';
		} else {
			this.setVignettes([]);
		}
	}

	xray(creatureId: number) {
		this.vignettes.forEach((v) => v.xray(creatureId));
	}

	bounce(creatureId, bounceHeight = 40) {
		Queue.throttledBounce(this.vignettes, creatureId, bounceHeight);
	}

	private setVignettes(nextVignettes) {
		const prevVs = this.vignettes;
		this.vignettes = Queue.reuseOldDomElements(prevVs, nextVignettes);
		Queue.deleteRemovedVignettes(this.vignettes, prevVs);
		Queue.insertUpdateNextVignettes(this.vignettes, prevVs, this.element);
	}

	private static throttledBounce = throttle((vignettes, creatureId, bounceHeight) => {
		let x = 0;
		vignettes.forEach((v, i) => {
			v.bounce(creatureId, i, x, bounceHeight);
			x += v.getWidth();
		});
	}, 500);

	private static getNextVignettes(creatures, creaturesNext, turnNum, eventHandlers) {
		const isDelayedCurr = (c) => refactor.creature.getIsDelayed(c, turnNum);
		const [undelayedCsCurr, delayedCsCurr] = utils.partitionAt(creatures, isDelayedCurr);
		const hasDelayedCurr = delayedCsCurr.length > 0;

		const isDelayedNext = (c) => refactor.creature.getIsDelayed(c, turnNum + 1);
		const [undelayedCsNext, delayedCsNext] = utils.partitionAt(creaturesNext, isDelayedNext);
		const hasDelayedNext = delayedCsNext.length > 0;

		const is1stCreature = utils.trueIfFirstElseFalse();

		const newCreatureVCurr = (c) =>
			new CreatureVignette(c, turnNum, eventHandlers, is1stCreature());
		const undelayedVsCurr = undelayedCsCurr.map(newCreatureVCurr);
		const delayMarkerVCurr = hasDelayedCurr
			? [new DelayMarkerVignette(turnNum, eventHandlers)]
			: [];
		const delayedVsCurr = delayedCsCurr.map(newCreatureVCurr);

		const turnEndMarkerV = [new TurnEndMarkerVignette(turnNum, eventHandlers)];

		const newCreatureVNext = (c) =>
			new CreatureVignette(c, turnNum + 1, eventHandlers, is1stCreature());
		const undelayedVsNext = undelayedCsNext.map(newCreatureVNext);
		const delayMarkerVNext = hasDelayedNext
			? [new DelayMarkerVignette(turnNum + 1, eventHandlers)]
			: [];
		const delayedVsNext = delayedCsNext.map(newCreatureVNext);
		const vsNext = [].concat(turnEndMarkerV, undelayedVsNext, delayMarkerVNext, delayedVsNext);

		/**
		 * NOTE: There are special cases when delayed creatures are at the front of the queue.
		 * -
		 * DEFAULT CASE - undelayed creatures > 0
		 * (not delayed, active) (delayed) (delayed) ...
		 * becomes:
		 * (not delayed, active) (delay marker) (delayed) (delayed) ...
		 * i.e., delay marker is in front of delayed creatures
		 * -
		 * SPECIAL CASE 1 - num undelayed creatures === 0, num delayed creatures > 1
		 * (delayed, active) (delayed) (delayed) ...
		 * becomes:
		 * (delayed, active) (delay marker) (delayed) (delayed) ...
		 * i.e., delay marker is behind first delayed creature
		 * -
		 * SPECIAL CASE 2 - num undelayed creatures === 0, num delayed creatures === 1
		 * (delayed, active) (turn end marker) ...
		 * becomes:
		 * (delayed, active) (turn end marker) ...
		 * i.e., no delayed marker
		 */

		if (undelayedVsCurr.length === 0 && delayedVsCurr.length > 1) {
			// NOTE: Special case 1
			const firstV = [delayedVsCurr.shift()];
			return [].concat(firstV, delayMarkerVCurr, delayedVsCurr, vsNext);
		} else if (undelayedVsCurr.length === 0 && delayedVsCurr.length === 1) {
			// NOTE: Special case 2
			return [].concat(delayedVsCurr, vsNext);
		}
		// NOTE: All other cases
		return [].concat(undelayedVsCurr, delayMarkerVCurr, delayedVsCurr, vsNext);
	}

	private static reuseOldDomElements(oldVignettes, newVignettes) {
		/**
		 * NOTE: For every vignette in newVignettes, if there's
		 * an equivalent in oldVignettes, use its DOM element.
		 * This keeps animations, transitions, and styles from breaking.
		 */
		const oldVDict = utils.arrToDict(oldVignettes, (v) => v.getHash());
		for (const newV of newVignettes) {
			const hash = newV.getHash();
			if (oldVDict.hasOwnProperty(hash)) {
				newV.el = oldVDict[hash].el;
			}
		}

		return newVignettes;
	}

	private static deleteRemovedVignettes(nextVignettes, prevVignettes) {
		const nextHashes = new Set(nextVignettes.map((v) => v.getHash()));
		const vignettesDeletedAtFront = utils.takeWhile(
			prevVignettes,
			(v) => !nextHashes.has(v.getHash()),
		);
		const spaceDeletedAtFrontOfQueue = vignettesDeletedAtFront.reduce(
			(acc, v) => acc + v.getWidth(),
			0,
		);
		const frontDeletedHashes = new Set(vignettesDeletedAtFront.map((v) => v.getHash()));

		let x = 0;
		prevVignettes.forEach((v, i) => {
			const hash = v.getHash();
			const w = v.getWidth();
			if (!nextHashes.has(hash)) {
				if (frontDeletedHashes.has(hash)) {
					v.deleteFromFront(i, x, spaceDeletedAtFrontOfQueue);
				} else {
					v.delete(i, x);
				}
			}
			x += w;
		});
	}

	private static insertUpdateNextVignettes(nextVignettes, prevVignettes, containerElement) {
		const prevHashes = new Set(prevVignettes.map((v) => v.getHash()));
		const nextHashes = new Set(nextVignettes.map((v) => v.getHash()));
		const [updateHashes, insertHashes] = utils.splitSetBy(nextHashes, (h) => prevHashes.has(h));

		let x = 0;
		nextVignettes.forEach((v, i) => {
			const hash = v.getHash();
			if (insertHashes.has(hash)) {
				v.insert(containerElement, i, x);
				x += v.getWidth();
			} else if (updateHashes.has(hash)) {
				v.update(i, x);
				x += v.getWidth();
			}
		});
	}
}

class Vignette {
	queuePosition = -1;
	turnNumber = -1;
	el: HTMLElement;
	eventHandlers: QueueEventHandlers = {};

	getHash() {
		return 'none';
	}

	getHTML() {
		return `<div></div>`;
	}

	insert(containerElement, queuePosition, x) {
		this.queuePosition = queuePosition;
		if (this.el) {
			this.el.remove();
		}

		const tmp = document.createElement('div');
		tmp.innerHTML = this.getHTML();
		this.el = tmp.firstChild as HTMLElement;
		containerElement.appendChild(this.el);

		this.addEvents();
		this.animateInsert(queuePosition, x);
		return this;
	}

	update(queuePosition, x) {
		this.queuePosition = queuePosition;
		this.animateUpdate(queuePosition, x);
		return this;
	}

	delete(queuePosition, x) {
		this.queuePosition = queuePosition;
		this.animateDelete(queuePosition, x).onfinish = () => {
			this.el.remove();
		};
		return this;
	}

	deleteFromFront(queuePosition, x, spaceDeletedAtFrontOfQueue) {
		this.queuePosition = queuePosition;
		this.animateDeleteFromFront(queuePosition, x, spaceDeletedAtFrontOfQueue).onfinish = () => {
			this.el.remove();
		};
		return this;
	}

	animateInsert(queuePosition, x) {
		const keyframes = [
			{
				transform: `translateX(${x + 500}px) translateY(-100px) scale(1)`,
				easing: 'ease-out',
			},
			{
				transform: `translateX(${x + 500}px) translateY(0px) scale(1)`,
				easing: 'ease-in',
				offset: 0.3,
			},
			{ transform: `translateX(${x}px) translateY(0px) scale(1)` },
		];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateUpdate(queuePosition, x) {
		const keyframes = [{ transform: `translateX(${x}px) translateY(0px) scale(1)` }];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateDelete(queuePosition, x) {
		const keyframes = [{ transform: `translateX(${x}px) translateY(-100px) scale(1)` }];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateDeleteFromFront(queuePosition, x, emptySpaceAtFrontOfQueue) {
		const keyframes = [
			{ transform: `translateX(${x - emptySpaceAtFrontOfQueue}px) translateY(0px) scale(1)` },
		];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateBounce(queuePosition, x, bounceH) {
		const NUM_BOUNCES = 3;
		const BOUNCE_MS = 280 * NUM_BOUNCES;

		const scale = queuePosition === 0 ? 1.25 : 1.0;
		const restingKeyframe = { transform: `translateX(${x}px) translateY(0px) scale(${scale})` };
		const bounceHs = new Array(NUM_BOUNCES)
			.fill(0)
			.map((_, i) => bounceH * Math.pow(1 / (i + 1), 2));
		const keyframes = [restingKeyframe];
		for (const bounceH of bounceHs) {
			keyframes.push({ transform: `translateX(${x}px) translateY(${bounceH}px) scale(${scale})` });
			keyframes.push(restingKeyframe);
		}

		const animation = this.el.animate(keyframes, { duration: BOUNCE_MS });
		animation.commitStyles();
		return animation;
	}

	getWidth() {
		return 80;
	}

	/* eslint-disable @typescript-eslint/no-unused-vars */
	xray(creatureId: number) {
		// pass
	}

	bounce(creatureId: number, i: number, x: number, bounceHeight: number) {
		// pass
	}
	/* eslint-enable @typescript-eslint/no-unused-vars */

	addEvents() {
		// pass
	}

	refresh() {
		// pass
	}
}

class CreatureVignette extends Vignette {
	creature;
	isActiveCreature: boolean;
	turnNumberIsCurrentTurn: boolean;

	constructor(
		creature,
		turnNumber,
		eventHandlers,
		isActiveCreature = false,
		turnNumberIsCurrentTurn = true,
	) {
		super();
		this.creature = creature;
		this.turnNumber = turnNumber;
		this.eventHandlers = eventHandlers;
		this.isActiveCreature = isActiveCreature;
		this.turnNumberIsCurrentTurn = turnNumberIsCurrentTurn;
	}

	getHash() {
		const id = 'id' + this.creature.id;
		return `creature_${id}_turn${this.turnNumber}`;
	}

	getHTML() {
		const c = this.creature;
		const classes = ['vignette', 'creature', 'type' + c.type, 'p' + c.team].join(' ');
		return `<div creatureid="${c.id}" class="${classes}">
				<div class="frame"></div>
				<div class="overlay_frame"></div>
				<div class="delay_frame"></div>
				<div class="stats"></div>
			</div>`;
	}

	setCreature(creature) {
		this.creature = creature;
	}

	insert(containerElement: HTMLElement, queuePosition: number, x: number) {
		super.insert(containerElement, queuePosition, x);
		this.updateDOM();
		return this;
	}

	update(queuePosition: number, x: number) {
		this.queuePosition = queuePosition;
		this.updateDOM();
		this.animateUpdate(queuePosition, x);
		return this;
	}

	private updateDOM() {
		const cl = this.el.classList;

		if (this.isActiveCreature) {
			cl.add('active');
		} else {
			cl.remove('active');
		}

		if (this.creature.temp) {
			cl.add('unmaterialized');
			cl.remove('materialized');
		} else {
			cl.remove('unmaterialized');
			cl.add('materialized');
		}

		if (refactor.creature.getIsDelayed(this.creature) && this.turnNumberIsCurrentTurn) {
			cl.add('delayed');
		}

		this.el.style.zIndex = this.creature.temp ? '1000' : this.queuePosition + 1 + '';

		const stats = this.creature.fatigueText;
		const statsClasses = ['stats', utils.toClassName(stats)].join(' ');
		const statsEl = this.el.querySelector('div.stats');
		statsEl.className = statsClasses;
		statsEl.textContent = stats;
	}

	animateInsert(queuePosition, x) {
		const scale = this.isActiveCreature ? 1.25 : 1.0;
		const keyframes = [
			{
				transform: `translateX(${x + 500}px) translateY(-100px) scale(${scale})`,
				easing: 'ease-out',
			},
			{
				transform: `translateX(${x + 500}px) translateY(0px) scale(${scale})`,
				easing: 'ease-in',
				offset: 0.3,
			},
			{ transform: `translateX(${x}px) translateY(0px) scale(${scale})` },
		];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateUpdate(queuePosition, x) {
		const scale = this.isActiveCreature ? 1.25 : 1.0;
		const keyframes = [{ transform: `translateX(${x}px) translateY(0px) scale(${scale})` }];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateDelete(queuePosition, x) {
		this.el.style.zIndex = '-1';
		const [x_, y, scale] = this.isActiveCreature ? [-this.getWidth(), 0, 1.25] : [x, -100, 1];
		const keyframes = [{ transform: `translateX(${x_}px) translateY(${y}px) scale(${scale})` }];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	animateDeleteFromFront(queuePosition, x, emptySpaceAtFrontOfQueue) {
		const scale = this.isActiveCreature ? 1.25 : 1;
		const keyframes = [
			{
				transform: `translateX(${x - emptySpaceAtFrontOfQueue}px) translateY(0px) scale(${scale})`,
			},
		];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}

	xray(creatureId: number) {
		if (creatureId === this.creature.id) {
			this.el.classList.add('xray');
		} else {
			this.el.classList.remove('xray');
		}
	}

	bounce(creatureId: number, i: number, x: number, bounceHeight: number) {
		if (creatureId === this.creature.id) {
			this.animateBounce(i, x, bounceHeight);
		}
	}

	addEvents() {
		const el = this.el;
		const h = this.eventHandlers;

		el.addEventListener('click', (e) => {
			if (h.onCreatureClick) h.onCreatureClick(this.creature);
		});

		el.addEventListener('mouseenter', () => {
			if (h.onCreatureMouseEnter) h.onCreatureMouseEnter(this.creature);
		});

		el.addEventListener('mouseleave', () => {
			if (h.onCreatureMouseLeave) h.onCreatureMouseLeave(this.creature);
		});
	}

	refresh() {
		this.updateDOM();
	}

	getWidth() {
		return this.isActiveCreature ? 100 : 80;
	}

	static is(obj) {
		return typeof obj !== 'undefined' && CreatureVignette.prototype.isPrototypeOf(obj);
	}
}

class TurnEndMarkerVignette extends Vignette {
	constructor(turnNumber, eventHandlers) {
		super();
		this.turnNumber = turnNumber;
		this.eventHandlers = eventHandlers;
	}

	getHash() {
		return ['turnend', 'turn' + this.turnNumber].join('_');
	}

	getHTML() {
		return `<div turn="${this.turnNumber}" roundmarker="1" class="vignette roundmarker">
			<div class="frame"></div>
            <div class="stats">Round ${this.turnNumber + 1}</div>
		</div>`;
	}

	addEvents() {
		const el = this.el;
		const h = this.eventHandlers;

		el.addEventListener('click', () => {
			if (h.onTurnEndClick) h.onTurnEndClick(this.turnNumber);
		});

		el.addEventListener('mouseenter', () => {
			if (h.onTurnEndMouseEnter) h.onTurnEndMouseEnter(this.turnNumber);
		});

		el.addEventListener('mouseleave', () => {
			if (h.onTurnEndMouseLeave) h.onTurnEndMouseLeave(this.turnNumber);
		});
	}
}

class DelayMarkerVignette extends Vignette {
	constructor(turnNumber, eventHandlers) {
		super();
		this.turnNumber = turnNumber;
		this.eventHandlers = eventHandlers;
	}

	getHTML() {
		return `<div class="vignette delaymarker">
			<div class="frame"></div>
            <div class="stats">Delayed</div>
		</div>`;
	}

	getHash() {
		return ['delay', 'turn' + this.turnNumber].join('_');
	}

	addEvents() {
		const el = this.el;
		const h = this.eventHandlers;

		el.addEventListener('click', () => {
			if (h.onDelayClick) h.onDelayClick();
		});

		el.addEventListener('mouseenter', () => {
			if (h.onDelayMouseEnter) h.onDelayMouseEnter();
		});

		el.addEventListener('mouseleave', () => {
			if (h.onDelayClick) h.onDelayMouseLeave();
		});
	}

	animateInsert(queuePosition, x) {
		const keyframes = [
			{
				transform: `translateX(${x}px) translateY(-100px) scale(1)`,
			},
			{
				transform: `translateX(${x}px) translateY(-100px) scale(1)`,
				easing: 'ease-out',
			},
			{ transform: `translateX(${x}px) translateY(0px) scale(1)` },
		];
		const animation = this.el.animate(keyframes, {
			duration: CONST.animDurationMS * 2,
			fill: 'forwards',
		});
		animation.commitStyles();
		return animation;
	}
}

const utils = {
	trueIfFirstElseFalse: () => {
		let v = true;
		return () => {
			if (v) {
				v = false;
				return true;
			}
			return false;
		};
	},

	arrToDict: (arr, keyFn) => {
		// NOTE: Turns an array to an object using the key function.
		// If the keyFn produces two or more identical keys, only the
		// last instance at that key will be kept.
		const result = {};
		for (const element of arr) {
			result[keyFn(element)] = element;
		}
		return result;
	},

	partitionAt: (arr, splitFn) => {
		let hasSplit = false;
		return arr.reduce(
			(acc, el, i, arr) => {
				hasSplit = hasSplit || splitFn(el, i, arr);
				acc[hasSplit ? 1 : 0].push(el);
				return acc;
			},
			[[], []],
		);
	},

	takeWhile: (arr, takeFn) => {
		const result = [];
		for (const element of arr) {
			if (!takeFn(element)) {
				break;
			}
			result.push(element);
		}
		return result;
	},

	splitSetBy: (s, splitFn) => {
		const a = new Set();
		const b = new Set();
		s.forEach((value, key, set) => {
			if (splitFn(value, key, set)) {
				a.add(value);
			} else {
				b.add(value);
			}
		});
		return [a, b];
	},

	toClassName: (s = '', ifNone = 'none', prefixIfNumeric = 'class_') => {
		const SEP = '_';
		s = (SEP + s + SEP).toLowerCase().replace(/[^a-z0-9]+/g, SEP);
		s = s.substring(1, s.length - 1);

		if (s === '' || s === SEP) {
			return ifNone;
		} else if ('0123456789'.indexOf(s[0]) !== -1) {
			return prefixIfNumeric + s;
		}
		return s;
	},
};

/* eslint-disable @typescript-eslint/no-unused-vars */
const refactor = {
	/** NOTE:
	 * Other modules that the present module relies on sometimes go
	 * into inconsistent states. In order to facilitate future
	 * improvements, workarounds/fixes are factored out of the present
	 * module's code and placed here.
	 * .
	 * Interface is here for easy browsing.
	 * Implementations are below.
	 */
	creatureQueue: {
		// NOTE: Suggestions for fixed/improved CreatureQueue interface.
		getCurrentQueue: (queue, activeCreature) => {
			return [];
		},
		getNextQueue: (queue) => {
			return [];
		},
	},
	creature: {
		// NOTE: Suggestions for fixed/improved Creature interface.
		getIsDelayed: (creature, turnNumber = -1) => {
			return false;
		},
	},
	stopGap: {
		init: () => {
			// pass
		},
		// NOTE: Extra data/functions needed only while refactor is pending.
		setTurnNumber: (turnNumber) => {
			// pass
		},
		setCreatureQueue: (queue) => {
			// pass
		},
		updateCreatureDelayStatus: (c, creatures, nextCreatures, turnNumber) => {
			// pass
		},
		turnNumber: -1,
		creatureIdsDelayedNextTurn: new Set(),
		creatureIdsDelayedCurrTurn: new Set(),
	},
};

refactor.creatureQueue = {
	getCurrentQueue: (creatureQueue, activeCreature) => {
		// NOTE: creatureQueue and game.activeCreature get into inconsistent states.
		// Mostly creatureQueue does *not* hold activeCreature ...
		// - But sometimes it does.
		// - And sometimes activeCreature isn't meant to be active.
		//
		// What we really need is *every* creature that still needs a turn.
		//
		// We'll check if activeCreature is in the queue.
		// - If not, we'll add it to the front.
		// - If so, we'll leave it where it is.
		if (!activeCreature) {
			return creatureQueue.queue;
		}
		const arr = Array.from(creatureQueue.queue);
		const containsActive = arr.some((c) => c.hasOwnProperty('id') && c['id'] === activeCreature.id);
		if (containsActive) {
			return arr;
		}
		return [activeCreature].concat(arr);
	},
	getNextQueue: (creatureQueue) => {
		// NOTE: if `getCurrentQueue` is added to creatureQueue
		// add this as well.
		return creatureQueue.nextQueue;
	},
};

refactor.stopGap.init = () => {
	refactor.stopGap.setTurnNumber(-1);
	refactor.stopGap.creatureIdsDelayedNextTurn = new Set();
	refactor.stopGap.creatureIdsDelayedCurrTurn = new Set();
};

refactor.stopGap.setTurnNumber = (turnNumber) => {
	if (turnNumber !== refactor.stopGap.turnNumber) {
		refactor.stopGap.turnNumber = turnNumber;

		refactor.stopGap.creatureIdsDelayedCurrTurn = refactor.stopGap.creatureIdsDelayedNextTurn;
		refactor.stopGap.creatureIdsDelayedNextTurn = new Set();

		refactor.stopGap.updateCreatureDelayStatus = (
			creature,
			creatures,
			nextCreatures,
			currTurnNumber,
		) => {
			/**
			 * NOTE: If creature.delayed == true:
			 * This might happen because the creature is/was just active and the user delayed the creature.
			 * Or it might happen because the creature received an attack that delayed it.
			 * Or it might be a holdover from a previous interaction.
			 * -
			 * This code should eventually not be necessary. Creature should ideally update/report its own status.
			 * This code assumes that a creature can never be undelayed for a given round.
			 */
			const creatureIsInCurrTurn = creatures.filter((c) => c.id === creature.id).length > 0;
			const creatureIsInNextTurn = nextCreatures.filter((c) => c.id === creature.id).length > 0;
			if (creatureIsInCurrTurn) {
				if (creature.delayed) {
					refactor.stopGap.creatureIdsDelayedCurrTurn.add(creature.id);
				}
			} else if (creatureIsInNextTurn) {
				if (creature.delayed) {
					refactor.stopGap.creatureIdsDelayedNextTurn.add(creature.id);
				}
			}
		};

		refactor.creature.getIsDelayed = (creature, turnNumber = -1) => {
			// NOTE: Creatures get into inconsistent states vis-a-vis the
			// queue. Sometimes a creature's state will go from delayed
			// to !delayed, while being active and having previously been delayed.
			// This is problematic.
			const currTurn = refactor.stopGap.turnNumber;
			if (currTurn === turnNumber) {
				return refactor.stopGap.creatureIdsDelayedCurrTurn.has(creature.id);
			} else if (currTurn + 1 === turnNumber) {
				return refactor.stopGap.creatureIdsDelayedNextTurn.has(creature.id);
			}
		};
	}
};

type QueueEventHandlers = {
	onCreatureClick?: (creature: Creature) => void;
	onCreatureMouseEnter?: (creature: Creature) => void;
	onCreatureMouseLeave?: (creature: Creature) => void;
	onDelayClick?: () => void;
	onDelayMouseEnter?: () => void;
	onDelayMouseLeave?: () => void;
	onTurnEndClick?: (turnNumber: number) => void;
	onTurnEndMouseEnter?: (turnNumber: number) => void;
	onTurnEndMouseLeave?: (turnNumber: number) => void;
};
