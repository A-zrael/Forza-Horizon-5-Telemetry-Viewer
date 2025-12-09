package track

import (
	"forza/models"
	"math"
)

// MapToMaster emits per-point mapping from a lap segment to the master lap.
// scaleS lets the caller stretch/shrink lap S to match master length.
// The provided callback receives (point index within the full session, lap-local
// relS (scaled), point coords, master index, master relS, master coords, distance).
func MapToMaster(lap []models.Trackpoint, master []models.Trackpoint, startIndex int, scaleS float64, emit func(idx int, relS, x, y float64, mi int, mRelS, mx, my, dist float64)) {
	if len(lap) == 0 || len(master) == 0 || emit == nil {
		return
	}
	if scaleS == 0 {
		scaleS = 1
	}

	j := 0
	for i := 0; i < len(lap); i++ {
		relS := (lap[i].S - lap[0].S) * scaleS
		for j+1 < len(master) && master[j+1].S <= relS {
			j++
		}
		closest := j
		if j+1 < len(master) {
			// pick closer between j and j+1 by S
			if relS-master[j].S > master[j+1].S-relS {
				closest = j + 1
			}
		}
		m := master[closest]
		dx := lap[i].X - m.X
		dy := lap[i].Y - m.Y
		distSq := dx*dx + dy*dy
		emit(startIndex+i, relS, lap[i].X, lap[i].Y, closest, m.S, m.X, m.Y, distSq)
	}
}

// MapRelSToMaster maps a single relS/point to the closest master point by S.
func MapRelSToMaster(master []models.Trackpoint, relS float64, px, py float64) (int, float64, float64, float64, float64) {
	if len(master) == 0 {
		return 0, 0, 0, 0, 0
	}
	j := 0
	for j+1 < len(master) && master[j+1].S <= relS {
		j++
	}
	closest := j
	if j+1 < len(master) {
		if relS-master[j].S > master[j+1].S-relS {
			closest = j + 1
		}
	}
	m := master[closest]
	dx := px - m.X
	dy := py - m.Y
	return closest, m.S, m.X, m.Y, dx*dx + dy*dy
}

// SignedDistanceToMaster returns signed lateral distance from a point to the given master index.
// Sign is based on cross product with the local tangent: positive = left of tangent, negative = right.
func SignedDistanceToMaster(master []models.Trackpoint, idx int, px, py float64) float64 {
	if len(master) == 0 || idx < 0 || idx >= len(master) {
		return 0
	}
	m := master[idx]
	dx := px - m.X
	dy := py - m.Y
	// tangent from neighbors
	tx, ty := 0.0, 0.0
	if idx > 0 && idx < len(master)-1 {
		tx = master[idx+1].X - master[idx-1].X
		ty = master[idx+1].Y - master[idx-1].Y
	} else if idx > 0 {
		tx = master[idx].X - master[idx-1].X
		ty = master[idx].Y - master[idx-1].Y
	} else if idx+1 < len(master) {
		tx = master[idx+1].X - master[idx].X
		ty = master[idx+1].Y - master[idx].Y
	}
	cross := tx*dy - ty*dx
	sign := 0.0
	if cross > 0 {
		sign = 1
	} else if cross < 0 {
		sign = -1
	}
	return math.Sqrt(dx*dx+dy*dy) * sign
}

// SignedDistanceAtRelS projects a point onto the master track at the given relS
// (distance along S) and returns the signed lateral distance (positive = left of tangent).
func SignedDistanceAtRelS(master []models.Trackpoint, relS float64, px, py float64) float64 {
	if len(master) == 0 {
		return 0
	}
	j := 0
	for j+1 < len(master) && master[j+1].S <= relS {
		j++
	}
	j2 := j + 1
	if j2 >= len(master) {
		j2 = len(master) - 1
	}
	p1 := master[j]
	p2 := master[j2]
	segX := p2.X - p1.X
	segY := p2.Y - p1.Y
	segLen2 := segX*segX + segY*segY
	t := 0.0
	if segLen2 > 0 {
		// project relS between p1.S..p2.S
		if p2.S != p1.S {
			t = (relS - p1.S) / (p2.S - p1.S)
		}
		t = clamp01(t)
	}
	closestX := p1.X + segX*t
	closestY := p1.Y + segY*t
	dx := px - closestX
	dy := py - closestY
	cross := segX*dy - segY*dx
	sign := 0.0
	if cross > 0 {
		sign = 1
	} else if cross < 0 {
		sign = -1
	}
	return math.Sqrt(dx*dx+dy*dy) * sign
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
