package track

import (
	"fmt"
	"forza/models"
	"math"
)

// DetectBrakeTiming flags early/late braking relative to the average brake-onset positions across laps.
// Uses brake pedal input when available; falls back to longitudinal decel.
func DetectBrakeTiming(samples []models.Sample, pts []models.Trackpoint, lapIdx []int, master []models.Trackpoint) []models.Event {
	if len(samples) == 0 || len(pts) == 0 || len(lapIdx) < 2 || len(master) == 0 {
		return nil
	}
	type onset struct {
		idx  int
		relS float64
	}
	brakeLow := 0.05  // normalized (0-1)
	brakeHigh := 0.15 // normalized (0-1)
	accelThresh := -3.0
	tolerance := 12.0 // meters difference from average to call early/late

	lapOnsets := make([][]onset, len(lapIdx)-1)
	for lap := 0; lap < len(lapIdx)-1; lap++ {
		start := lapIdx[lap]
		end := lapIdx[lap+1]
		if start < 0 || end > len(samples) || end <= start+1 {
			continue
		}
		baseS := pts[start].S
		prevBrake := 0.0
		if samples[start].HasInputBrake {
			prevBrake = clamp(float64(samples[start].Brake)/255.0, 0, 1)
		}
		for i := start + 1; i < end; i++ {
			cur := samples[i]
			curBrake := 0.0
			if cur.HasInputBrake {
				curBrake = clamp(float64(cur.Brake)/255.0, 0, 1)
			}
			trigger := false
			if cur.HasInputBrake || samples[i-1].HasInputBrake {
				if prevBrake <= brakeLow && curBrake >= brakeHigh {
					trigger = true
				}
			} else {
				// fallback to decel
				if samples[i-1].AccelX >= accelThresh && cur.AccelX < accelThresh {
					trigger = true
				}
			}
			if trigger {
				relS := pts[i].S - baseS
				lapOnsets[lap] = append(lapOnsets[lap], onset{idx: i, relS: relS})
			}
			prevBrake = curBrake
		}
	}

	// Average positions by order index.
	maxCount := 0
	for _, l := range lapOnsets {
		if len(l) > maxCount {
			maxCount = len(l)
		}
	}
	if maxCount == 0 {
		return nil
	}
	means := make([]float64, maxCount)
	counts := make([]int, maxCount)
	for _, l := range lapOnsets {
		for k, o := range l {
			means[k] += o.relS
			counts[k]++
		}
	}
	for k := range means {
		if counts[k] > 0 {
			means[k] /= float64(counts[k])
		}
	}

	var events []models.Event
	for _, l := range lapOnsets {
		for k, o := range l {
			if counts[k] == 0 {
				continue
			}
			delta := o.relS - means[k]
			if math.Abs(delta) < tolerance {
				continue
			}
			typ := "late_brake"
			if delta < 0 {
				typ = "early_brake"
			}
			px, py := pts[o.idx].X, pts[o.idx].Y
			mi, mRelS, mx, my, dist := MapRelSToMaster(master, o.relS, px, py)
			ev := models.Event{
				Index:      o.idx,
				Time:       samples[o.idx].Time,
				Type:       typ,
				Note:       fmt.Sprintf("brake %d: %+0.1fm vs avg", k+1, delta),
				MasterIdx:  mi,
				MasterRelS: mRelS,
				MasterX:    mx,
				MasterY:    my,
				DistanceSq: dist,
			}
			events = append(events, ev)
		}
	}

	return events
}
