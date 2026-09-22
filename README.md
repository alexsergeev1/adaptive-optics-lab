# Adaptive Optics Lab

[Live demo](https://alexsergeev1.github.io/adaptive-optics-lab/)

An interactive simulation of a telescope looking through a moving phase screen. Both cameras receive the same disturbance. The reference camera bypasses the mirror. The second camera uses the selected correction.

## Try it

1. Raise the turbulence and freeze the phase screen.
2. Switch among **Off**, **Tip / tilt**, and **Full** on the same frozen disturbance.
3. Compare the camera images, fine-line contrast, and residual phase RMS. Resume the screen to watch the controller track changing aberrations.

Run locally with `node serve.mjs` and open [the local demo](http://127.0.0.1:4174/). Run `node --test` to verify the optical propagation, reconstructor, and correction on four frozen screens. No package installation is required.

## Model

- The deterministic phase screen combines nine pupil modes. The simulated mirror controls tip, tilt, focus, and two astigmatism modes.
- A Shack–Hartmann slope model averages the phase gradient in each lenslet. Simulated mirror pokes build an interaction matrix. A regularized least-squares reconstructor and a bounded integral controller drive the mirror using residual slope measurements.
- The camera Fourier transforms the complex circular pupil to compute a normalized point spread function, then convolves it with the resolution chart. Fine-line contrast is the normalized amplitude at the 8-pixel line-pair period in a fixed region of the chart.

This is a monochromatic, shift-invariant simulation. It uses deterministic modal disturbances and idealized sensor slopes. Bench measurements, actuator dynamics, photon noise, and atmospheric seeing calibration are outside the model.

The design is informed by [ESO's High Order Testbench](https://www.eso.org/sci/facilities/develop/ao/sys/hot.html).
