import { PointerSensor } from '@dnd-kit/core';

export default class HomePointerSensor extends PointerSensor {
  constructor(props) {
    super(props);
    // Reuse dnd-kit's listener lifecycle: every native end/cancel detaches blur too.
    this.windowListeners.add('blur', this.handleCancel);
  }
}
