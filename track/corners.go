package track

import (
	"forza/models"
	"math"
)

// CornerDef describes a detected corner along the master lap.
type CornerDef struct {
	Index     int
	StartS    float64
	EndS      float64
	ApexS     float64
	Direction string
	AngleRad  float64
}

// DetectCorners identifies corners on the master lap using curvature with smoothing and merging.
// Returns coarse start/end/apex positions; callers can refine metrics per lap.
func DetectCorners(master []models.Trackpoint) []CornerDef {
	if len(master) < 5 {
		return nil
	}

	// Compute curvature (delta heading over distance) and smooth to avoid chatter.
	curv := make([]float64, len(master))
	for i := 1; i < len(master)-1; i++ {
		dTheta := wrapAngle(master[i+1].Theta - master[i-1].Theta)
		dS := master[i+1].S - master[i-1].S
		if dS != 0 {
			curv[i] = dTheta / dS
		}
	}
	curv = smoothCurv(curv, 5)

	var raw []CornerDef
	const onThresh = 0.006  // rad/m
	const offThresh = 0.004 // hysteresis
	const minAngle = 0.12   // rad (~7 deg)
	const minLen = 8.0      // meters
	const minGap = 12.0     // meters between corners
	const mergeGap = 25.0   // merge close same-direction segments

	inCorner := false
	startIdx := 0
	maxIdx := 0
	maxCurv := 0.0
	for i := 0; i < len(curv); i++ {
		ac := math.Abs(curv[i])
		if !inCorner && ac > onThresh {
			inCorner = true
			startIdx = i
			maxIdx = i
			maxCurv = curv[i]
		}
		if inCorner {
			if ac > math.Abs(maxCurv) {
				maxCurv = curv[i]
				maxIdx = i
			}
			if ac < offThresh || i == len(curv)-1 {
				endIdx := i
				if endIdx <= startIdx {
					inCorner = false
					continue
				}
				angle := wrapAngle(master[endIdx].Theta - master[startIdx].Theta)
				length := master[endIdx].S - master[startIdx].S
				if math.Abs(angle) >= minAngle && length >= minLen {
					dir := "L"
					if angle < 0 {
						dir = "R"
					}
					raw = append(raw, CornerDef{
						StartS:    master[startIdx].S,
						EndS:      master[endIdx].S,
						ApexS:     master[maxIdx].S,
						Direction: dir,
						AngleRad:  angle,
					})
				}
				inCorner = false
			}
		}
	}

	// Merge close same-direction segments to avoid splitting shallow bends.
	var merged []CornerDef
	for _, c := range raw {
		if len(merged) == 0 {
			merged = append(merged, c)
			continue
		}
		last := &merged[len(merged)-1]
		if c.Direction == last.Direction && c.StartS-last.EndS < mergeGap {
			last.EndS = c.EndS
			last.AngleRad += c.AngleRad
			if math.Abs(c.AngleRad) > math.Abs(last.AngleRad) {
				last.ApexS = c.ApexS
			}
			continue
		}
		if c.StartS-last.EndS < minGap {
			last.EndS = c.EndS
			last.AngleRad += c.AngleRad
			if math.Abs(c.AngleRad) > math.Abs(last.AngleRad) {
				last.ApexS = c.ApexS
			}
			continue
		}
		merged = append(merged, c)
	}

	for i := range merged {
		merged[i].Index = i
	}
	return merged
}

func smoothCurv(vals []float64, window int) []float64 {
	if window <= 1 || len(vals) == 0 {
		return vals
	}
	out := make([]float64, len(vals))
	var sum float64
	for i, v := range vals {
		sum += v
		if i >= window {
			sum -= vals[i-window]
		}
		count := window
		if i+1 < window {
			count = i + 1
		}
		out[i] = sum / float64(count)
	}
	return out
}
