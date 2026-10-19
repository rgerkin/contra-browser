// Local AudioWorklet; bounded stereo ring buffer, no dynamic code or network.
class ContraAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(4096);
    this.right = new Float32Array(4096);
    this.read = 0; this.write = 0; this.count = 0;
    this.port.onmessage = ({data}) => {
      if (data === 'clear') { this.count = 0; this.read = this.write; return; }
      const [left, right] = data;
      for (let i = 0; i < left.length; i++) {
        if (this.count === 4096) { this.read = (this.read + 1) & 4095; this.count--; }
        this.left[this.write] = left[i]; this.right[this.write] = right[i];
        this.write = (this.write + 1) & 4095; this.count++;
      }
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (this.count) {
        left[i] = this.left[this.read]; right[i] = this.right[this.read];
        this.read = (this.read + 1) & 4095; this.count--;
      } else { left[i] = 0; right[i] = 0; }
    }
    return true;
  }
}
registerProcessor('contra-audio', ContraAudio);
