#include <raytracing/geometry/include/intersection.h>

Intersection::Intersection(const Vector& pos, const Vector& norm, double dist)
    : position_(pos), normal_(norm), distance_(dist) {
}

const Vector& Intersection::GetPosition() const {
    return position_;
}

const Vector& Intersection::GetNormal() const {
    return normal_;
}

double Intersection::GetDistance() const {
    return distance_;
}
