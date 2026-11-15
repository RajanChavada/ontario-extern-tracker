// JSX-like templates without a build step. Components are plain React, so the
// same slide components can be mounted inside a Remotion composition later.
import { createElement, Fragment } from 'react';
import htm from 'htm';

export const html = htm.bind(createElement);
export { Fragment };
