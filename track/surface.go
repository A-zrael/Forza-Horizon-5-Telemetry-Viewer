package track

import (
	"forza/models"
	"math"
)

// ClassifySurface labels each point using available telemetry:
// - "puddle" when wheels report water contact
// - "rumble" when wheels report rumble strips
// - "dirt" when lateral/heading variance and slip indicate loose surface
// - "asphalt" otherwise
// windowSize is number of samples (~30 => ~0.5s at 60Hz). Defaults to 30 when <=0.
func ClassifySurface(samples []models.Sample, points []models.Trackpoint, windowSize int) []string {
	if windowSize <= 0 {
		windowSize = 30
	}
	n := len(samples)
	if len(points) != n || n == 0 {
		return make([]string, len(points))
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		start := i - windowSize + 1
		if start < 0 {
			start = 0
		}
		latVar := varianceAccelX(samples[start : i+1])
		yawVar := varianceYaw(points[start : i+1])
		slip := slipEstimate(samples[start : i+1])
		onRumble := wheelSum(samples[i].WheelOnRumbleFL, samples[i].WheelOnRumbleFR, samples[i].WheelOnRumbleRL, samples[i].WheelOnRumbleRR) > 0.5
		inPuddle := wheelSum(samples[i].WheelInPuddleFL, samples[i].WheelInPuddleFR, samples[i].WheelInPuddleRL, samples[i].WheelInPuddleRR) > 0.3

		switch {
		case inPuddle:
			out[i] = "puddle"
		case onRumble:
			out[i] = "rumble"
		case latVar > 0.8 && yawVar > 0.5 && slip > 0.2:
			out[i] = "dirt"
		default:
			out[i] = "asphalt"
		}
	}
	return out
}

func varianceAccelX(s []models.Sample) float64 {
	if len(s) == 0 {
		return 0
	}
	var sum, sum2 float64
	for _, v := range s {
		ax := v.AccelX
		sum += ax
		sum2 += ax * ax
	}
	n := float64(len(s))
	mean := sum / n
	return sum2/n - mean*mean
}

func varianceYaw(p []models.Trackpoint) float64 {
	if len(p) < 2 {
		return 0
	}
	diffs := make([]float64, 0, len(p)-1)
	for i := 1; i < len(p); i++ {
		d := wrapAngle(p[i].Theta - p[i-1].Theta)
		diffs = append(diffs, d)
	}
	// variance of diffs
	var sum, sum2 float64
	for _, v := range diffs {
		sum += v
		sum2 += v * v
	}
	n := float64(len(diffs))
	mean := sum / n
	return sum2/n - mean*mean
}

func wrapAngle(a float64) float64 {
	for a > math.Pi {
		a -= 2 * math.Pi
	}
	for a < -math.Pi {
		a += 2 * math.Pi
	}
	return a
}

func slipEstimate(s []models.Sample) float64 {
	if len(s) < 2 {
		return 0
	}
	var sum float64
	for i := 1; i < len(s); i++ {
		prev := s[i-1]
		cur := s[i]
		dt := cur.Time - prev.Time
		if dt <= 0 {
			continue
		}
		dSpeed := cur.Speed - prev.Speed
		slip := cur.AccelX - dSpeed/dt
		sum += slip
	}
	return sum / float64(len(s)-1)
}

func wheelSum(vals ...float64) float64 {
	var sum float64
	for _, v := range vals {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		sum += v
	}
	return sum
}
