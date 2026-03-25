export interface PIDConfig {
  kp: number;
  ki: number;
  kd: number;
  setpoint: number;
  windupMax: number;
}

export class PIDController {
  private config: PIDConfig;
  private prevError: number = 0;
  private integral: number = 0;
  private emaError: number = 0;
  private alpha: number = 0.3; // Smoothing factor for the D term

  constructor(config: PIDConfig) {
    this.config = { ...config };
  }

  update(currentValue: number, dt: number): number {
    if (dt <= 0) return 0; // Prevent division by zero

    const error = currentValue - this.config.setpoint;

    // Proportional
    const pOut = this.config.kp * error;

    // Integral (with anti-windup clamping)
    this.integral += error * dt;
    this.integral = Math.max(
      -this.config.windupMax,
      Math.min(this.config.windupMax, this.integral)
    );
    const iOut = this.config.ki * this.integral;

    // Derivative (with EMA low-pass filter applied on error signal to prevent spikes)
    this.emaError = (this.alpha * error) + ((1 - this.alpha) * this.emaError);

    const derivative = (this.emaError - this.prevError) / dt;
    const dOut = this.config.kd * derivative;

    this.prevError = this.emaError;

    return pOut + iOut + dOut;
  }

  reset(): void {
    this.prevError = 0;
    this.integral = 0;
    this.emaError = 0;
  }
}
