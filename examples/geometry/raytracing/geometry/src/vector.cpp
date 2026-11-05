#include <raytracing/geometry/include/vector.h>

#include <algorithm>
#include <cmath>

Vector::Vector() = default;

Vector::Vector(double x, double y, double z) : coordinates_{x, y, z} {
}

double& Vector::operator[](size_t ind) {
    return coordinates_[ind];
}

double Vector::operator[](size_t ind) const {
    return coordinates_[ind];
}

Vector& Vector::operator-=(const Vector& rhs) {
    for (size_t i = 0; i < coordinates_.size(); ++i) {
        coordinates_[i] -= rhs[i];
    }
    return *this;
}

Vector& Vector::operator+=(const Vector& rhs) {
    for (size_t i = 0; i < coordinates_.size(); ++i) {
        coordinates_[i] += rhs[i];
    }
    return *this;
}

Vector Vector::operator-() const {
    return {-coordinates_[0], -coordinates_[1], -coordinates_[2]};
}

void Vector::Normalize() {
    const double length = Length(*this);
    if (length > 0) {
        for (double& coordinate : coordinates_) {
            coordinate /= length;
        }
    }
}

void Vector::Scale(double value) {
    for (double& coordinate : coordinates_) {
        coordinate *= value;
    }
}

void Vector::Flip() {
    Scale(-1);
}

Vector operator-(Vector lhs, const Vector& rhs) {
    return lhs -= rhs;
}

Vector operator+(Vector lhs, const Vector& rhs) {
    return lhs += rhs;
}

Vector operator*(Vector lhs, double value) {
    lhs.Scale(value);
    return lhs;
}

Vector operator*(double value, Vector rhs) {
    return rhs * value;
}

Vector operator+(double value, Vector rhs) {
    for (size_t i = 0; i < 3; ++i) {
        rhs[i] += value;
    }
    return rhs;
}

Vector operator*(const Vector& lhs, const Vector& rhs) {
    return {lhs[0] * rhs[0], lhs[1] * rhs[1], lhs[2] * rhs[2]};
}

double DotProduct(const Vector& lhs, const Vector& rhs) {
    return lhs[0] * rhs[0] + lhs[1] * rhs[1] + lhs[2] * rhs[2];
}

Vector CrossProduct(const Vector& a, const Vector& b) {
    return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}

double Length(const Vector& vec) {
    return std::hypot(vec[0], vec[1], vec[2]);
}

double Max(const Vector& vec) {
    return std::max({vec[0], vec[1], vec[2]});
}
