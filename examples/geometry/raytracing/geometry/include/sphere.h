#pragma once

#include <raytracing/geometry/include/vector.h>

class Sphere {
public:
    Sphere(const Vector& center, double radius);

    const Vector& GetCenter() const;
    double GetRadius() const;

private:
    Vector center_;
    double radius_;
};
